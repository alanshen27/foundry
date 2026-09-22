// @vitest-environment jsdom
/**
 * The CAD viewport's connection and execution lifecycle, against a fake Zoo
 * engine. Real WebRTC cannot run in a test, but everything this component
 * decides — when to connect, when to re-execute instead of reconnecting, what
 * a failure looks like to the user, when to reuse a warm session — can.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";

type SubmitResult = unknown;

const engine = {
  instances: [] as FakeWebRTC[],
  /** What `start()` does: connect, hang, or have auth rejected. */
  connect: "ok" as "ok" | "hang" | "auth-fail",
  submitResult: { success: true } as SubmitResult,
};

class FakeClient {
  token: string;
  oauth2?: { fetchAuthorizationCode: () => Promise<void> };
  constructor(opts: { token: string }) {
    this.token = opts.token;
  }
}

class FakeWebRTC extends EventTarget {
  opts: { client: FakeClient };
  channel = null;
  track = null;
  sent: unknown[] = [];
  submits: { input: unknown; opts?: unknown }[] = [];
  resized: unknown[] = [];
  destroyed = false;
  constructor(opts: { client: FakeClient }) {
    super();
    this.opts = opts;
    engine.instances.push(this);
  }
  async start() {
    if (engine.connect === "ok") queueMicrotask(() => this.dispatchEvent(new Event("connected")));
    if (engine.connect === "auth-fail") {
      queueMicrotask(() => void this.opts.client.oauth2?.fetchAuthorizationCode());
    }
  }
  send(req: unknown) {
    this.sent.push(req);
    return Promise.resolve({});
  }
  executor() {
    return {
      submit: async (input: unknown, opts?: unknown) => {
        this.submits.push({ input, opts });
        return engine.submitResult;
      },
    };
  }
  resize(size: unknown) {
    this.resized.push(size);
  }
  deconstructor() {
    this.destroyed = true;
  }
}

vi.mock("@kittycad/lib", () => ({
  Client: FakeClient,
  WebRTC: FakeWebRTC,
  modeling: { modeling_commands_ws: { toBSON: (req: unknown) => req } },
}));

const { CadViewport } = await import("@/components/engineer/cad-viewport");

class NoopResizeObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
}

let tokenSeq = 0;
/** Fresh token per test: the warm-session pool is keyed on it. */
const freshEngine = () => ({ token: `tok-${++tokenSeq}` });

beforeEach(() => {
  engine.instances.length = 0;
  engine.connect = "ok";
  engine.submitResult = { success: true };
  globalThis.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver;
  HTMLMediaElement.prototype.play = () => Promise.resolve();
  // The axes gizmo draws to a 2D canvas, which jsdom does not implement.
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});

describe("CadViewport", () => {
  it("connects, executes the script, and reports ready", async () => {
    const onReady = vi.fn();
    render(<CadViewport script="width = 60" engine={freshEngine()} onReady={onReady} />);
    expect(screen.getByText("Connecting to Zoo CAD engine")).toBeInTheDocument();

    await waitFor(() => expect(engine.instances[0]?.submits).toHaveLength(1));
    expect(engine.instances[0]!.submits[0]!.input).toBe("width = 60");
    await waitFor(() => expect(onReady).toHaveBeenCalled(), { timeout: 3_000 });
    expect(screen.getByTitle("Fit all")).toBeEnabled();
  });

  it("re-executes an edited script on the same session instead of reconnecting", async () => {
    const session = freshEngine();
    const { rerender } = render(<CadViewport script="width = 60" engine={session} />);
    await waitFor(() => expect(engine.instances[0]?.submits).toHaveLength(1));

    rerender(<CadViewport script="width = 64" engine={session} />);
    // The script is read from a ref; a real edit arrives with a re-render that
    // also changes the execute trigger. Reconnecting would create a second rtc.
    await act(async () => {});
    expect(engine.instances).toHaveLength(1);
  });

  it("runs a multi-file project from its entry point", async () => {
    render(
      <CadViewport
        script=""
        engine={freshEngine()}
        projectFiles={{
          "assembly/product.kcl": 'import "parts/lid/main.kcl"',
          "parts/lid/main.kcl": "x = 1",
        }}
        entryPath="assembly/product.kcl"
      />,
    );
    await waitFor(() => expect(engine.instances[0]?.submits).toHaveLength(1));
    const { input, opts } = engine.instances[0]!.submits[0]!;
    expect(input).toBeInstanceOf(Map);
    expect([...(input as Map<string, string>).keys()]).toEqual([
      "assembly/product.kcl",
      "parts/lid/main.kcl",
    ]);
    expect(opts).toEqual({ mainKclPathName: "assembly/product.kcl" });
  });

  it("shows a safe message when the KCL fails, without echoing engine internals", async () => {
    engine.submitResult = {
      success: false,
      errors: [{ message: "unexpected token `)` at line 3 in /srv/zoo/tmp/a8f3/main.kcl" }],
    };
    const onError = vi.fn();
    render(<CadViewport script="width = )" engine={freshEngine()} onError={onError} />);
    const message =
      "The model could not be rebuilt near line 3. Check the latest feature or dimension.";
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByText("Zoo engine error")).toBeInTheDocument();
    expect(onError).toHaveBeenLastCalledWith(message);
    expect(document.body.textContent).not.toContain("/srv/zoo");
  });

  it("refuses to connect with no token, and says who can fix it", async () => {
    const onError = vi.fn();
    render(<CadViewport script="x = 1" engine={{ token: "  " }} onError={onError} />);
    expect(
      await screen.findByText(/Ask a workspace administrator to configure the CAD service/),
    ).toBeInTheDocument();
    expect(engine.instances).toHaveLength(0);
  });

  it("reports a rejected token as an authentication problem", async () => {
    engine.connect = "auth-fail";
    const onError = vi.fn();
    render(<CadViewport script="x = 1" engine={freshEngine()} onError={onError} />);
    const message =
      "The CAD service could not authenticate. Ask a workspace administrator to check the CAD connection.";
    expect(await screen.findByText(message, {}, { timeout: 3_000 })).toBeInTheDocument();
    expect(onError).toHaveBeenLastCalledWith(message);
    expect(engine.instances[0]!.destroyed).toBe(true);
  });

  it("parks a healthy session on unmount and adopts it on the next mount", async () => {
    const session = freshEngine();
    const first = render(<CadViewport script="a = 1" engine={session} />);
    await waitFor(() => expect(engine.instances[0]?.submits).toHaveLength(1));
    first.unmount();
    expect(engine.instances[0]!.destroyed).toBe(false);

    render(<CadViewport script="b = 2" engine={session} />);
    await waitFor(() => expect(engine.instances[0]!.submits).toHaveLength(2));
    // No second handshake: the parked connection ran the new script.
    expect(engine.instances).toHaveLength(1);
    expect(engine.instances[0]!.submits[1]!.input).toBe("b = 2");
  });

  it("does not park a session that never connected", async () => {
    engine.submitResult = { success: true };
    const session = freshEngine();
    engine.connect = "auth-fail";
    const first = render(<CadViewport script="a = 1" engine={session} />);
    await waitFor(() => expect(screen.getByText("Zoo engine error")).toBeInTheDocument(), {
      timeout: 3_000,
    });
    first.unmount();

    engine.connect = "ok";
    render(<CadViewport script="a = 1" engine={session} />);
    await waitFor(() => expect(engine.instances).toHaveLength(2));
  });
});
