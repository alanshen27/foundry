import { afterEach, describe, expect, it, vi } from "vitest";
import { withLiveToolDrafts } from "@/server/chat-run/tool-draft";

afterEach(() => vi.useRealTimers());
describe("streamed tool edits", () => {
  it("previews source as arguments arrive, but executes only the completed tool", async () => {
    vi.useFakeTimers();
    const execute = vi.fn().mockResolvedValue({ ok: true });
    const observer = { emit: vi.fn(), end: vi.fn() };
    const tools = withLiveToolDrafts(
      { write_code_file: { execute }, web_search: { execute } },
      observer,
    ) as Record<string, any>;
    await tools.write_code_file.onInputDelta({
      toolCallId: "t",
      inputTextDelta: '{"path":"src/main.cpp","content":"int main()',
    });
    expect(observer.emit).toHaveBeenLastCalledWith(
      expect.objectContaining({ path: "src/main.cpp", content: "int main()" }),
    );
    expect(execute).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    await tools.write_code_file.onInputDelta({ toolCallId: "t", inputTextDelta: ' {}"}' });
    expect(observer.emit).toHaveBeenLastCalledWith(
      expect.objectContaining({ content: "int main() {}" }),
    );
    const input = { path: "src/main.cpp", content: "int main() {}" };
    await tools.write_code_file.execute(input, { toolCallId: "t" });
    expect(execute).toHaveBeenCalledWith(input, { toolCallId: "t" });
    expect(observer.end).toHaveBeenCalledWith("t");
    expect(tools.web_search.onInputDelta).toBeUndefined();
  });
  it("clears previews when validation fails and ignores cancelled input", async () => {
    const observer = { emit: vi.fn(), end: vi.fn() };
    const tools = withLiveToolDrafts(
      {
        save_circuit: {
          execute: async () => {
            throw new Error("Invalid pin");
          },
        },
      },
      observer,
    ) as Record<string, any>;
    const signal = AbortSignal.abort();
    await tools.save_circuit.onInputDelta({
      toolCallId: "t",
      inputTextDelta: "{}",
      abortSignal: signal,
    });
    expect(observer.emit).not.toHaveBeenCalled();
    await expect(tools.save_circuit.execute({}, { toolCallId: "t" })).rejects.toThrow(
      "Invalid pin",
    );
    expect(observer.end).toHaveBeenCalledWith("t");
  });
});
