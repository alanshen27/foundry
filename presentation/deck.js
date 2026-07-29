(() => {
  const sourceRoot = "..";

  const slideData = [
    {
      kind: "cover",
      theme: "cover",
      speaker: "Shared opening",
      section: "Opening",
      label: "FOUNDRY opening cover",
      body: `
        <div class="cover-signal">
          <div class="surface-brand"><img src="assets/foundry-logo.png" alt="" /><span>FOUNDRY</span></div>
          <canvas class="glyph-field" data-seed="foundry-final-opening" data-cols="43" data-rows="30"></canvas>
          <p class="signal-poem">When form dissolves, the center holds.<br />A silent pulse from sentence to ship.</p>
        </div>
        <div class="cover-copy">
          <div class="brand-line"><img src="assets/foundry-logo.png" alt="FOUNDRY mark" /><strong>FOUNDRY</strong></div>
          <p class="eyebrow">FINAL PROJECT PRESENTATION</p>
          <h1>One workspace.<br />One product journey.</h1>
          <p class="cover-lede">Ideate. Engineer. Verify. Launch.</p>
          <div class="cover-team">Will Sun · Alan Shen · Jason Xiao · Zhiheng Li</div>
        </div>`,
      footer: ["FOUNDRY", "ESAP AI", "FINAL"],
      noteTitle: "Shared opening — 20 seconds",
      notes:
        "FOUNDRY is our answer to a simple question: why does building a physical product still mean losing context every time work moves from requirements to hardware, software, verification, and launch? We built one shared workspace that carries a product through that entire journey. We will show the problem, the system we implemented, the engineering decisions behind it, the challenges we solved, and then demonstrate the complete workflow live.",
      sources: [`${sourceRoot}/README.md`, "https://foundry-web-3wiy.onrender.com/"],
    },
    {
      kind: "content",
      theme: "paper",
      number: 1,
      speaker: "Will Sun",
      section: "Problem",
      label: "Physical-product work breaks at handoffs",
      body: `
        <div class="slide-pad">
          <header class="slide-header"><p class="eyebrow">01 / THE PROBLEM</p><h2>Physical-product work breaks at the handoffs.</h2></header>
          <div class="handoff-scene">
            <div class="handoff-spine"><span class="pulse-dot p1"></span><span class="pulse-dot p2"></span><span class="pulse-dot p3"></span></div>
            <div class="handoff-row left r1"><span>01</span><div><strong>Requirements</strong><small>Docs decide what matters.</small></div></div>
            <div class="handoff-row right r2"><span>02</span><div><strong>Mechanical + electrical</strong><small>CAD and PCB decide what fits.</small></div></div>
            <div class="handoff-row left r3"><span>03</span><div><strong>Firmware</strong><small>Code decides how it behaves.</small></div></div>
            <div class="handoff-row right r4"><span>04</span><div><strong>Verification</strong><small>Tests discover what drifted.</small></div></div>
            <div class="handoff-row left r5"><span>05</span><div><strong>Launch</strong><small>The site repeats the latest claim.</small></div></div>
          </div>
          <p class="bottom-claim">The files survive. <span>The reasoning between them does not.</span></p>
        </div>`,
      footer: ["FOUNDRY", "WILL SUN · PROBLEM", "01 / 12"],
      noteTitle: "Will Sun — approximately 55 seconds",
      notes:
        "Physical products are built across different disciplines, and every discipline has its own tool. Requirements live in documents, mechanical work in CAD, electronics in PCB software, firmware in a repository, verification in checklists, and launch information in a site builder. Each tool can store its own artifact, but the handoff between tools is where context disappears. The design may survive, but the reason for the design, the requirement it satisfies, and the test that proves it become separate conversations. Our problem was therefore not simply file management. It was maintaining one understandable thread across the whole product.",
      sources: [
        `${sourceRoot}/docs/proposal.md — Project Goal`,
        `${sourceRoot}/Foundry_PRD_Cursor.md — Problem`,
      ],
    },
    {
      kind: "content",
      theme: "dark",
      number: 2,
      speaker: "Will Sun",
      section: "Product",
      label: "FOUNDRY connects four product stages",
      body: `
        <div class="slide-pad">
          <header class="slide-header compact"><p class="eyebrow">01 / THE PRODUCT ANSWER</p><h2>One workspace keeps the thread alive.</h2></header>
          <div class="stage-orbit">
            <svg viewBox="0 0 1200 470" role="img" aria-label="Connected four-stage path">
              <defs><linearGradient id="pathSignal" x1="0" x2="1"><stop offset="0" stop-color="#e11d48"/><stop offset=".34" stop-color="#ff5a00"/><stop offset=".68" stop-color="#0d9488"/><stop offset="1" stop-color="#f4f2ec"/></linearGradient></defs>
              <path class="stage-path ghost" d="M120 275 C255 85 420 85 520 235 S790 430 1070 165"/>
              <path class="stage-path signal" d="M120 275 C255 85 420 85 520 235 S790 430 1070 165"/>
              <circle cx="120" cy="275" r="12" fill="#e11d48"/><circle cx="410" cy="145" r="12" fill="#ff5a00"/>
              <circle cx="735" cy="338" r="12" fill="#0d9488"/><circle cx="1070" cy="165" r="12" fill="#f4f2ec"/>
            </svg>
            <div class="stage-label s1"><span>01</span><strong>IDEATE</strong><small>Brief + requirements</small></div>
            <div class="stage-label s2"><span>02</span><strong>ENGINEER</strong><small>Hardware + software</small></div>
            <div class="stage-label s3"><span>03</span><strong>VERIFY</strong><small>Checks + evidence</small></div>
            <div class="stage-label s4"><span>04</span><strong>LAUNCH</strong><small>Media + site + checkout</small></div>
          </div>
          <div class="signal-definition"><span>ONE PROJECT</span><strong>shared context · shared permissions · shared history</strong></div>
        </div>`,
      footer: ["FOUNDRY", "WILL SUN · PRODUCT", "02 / 12"],
      noteTitle: "Will Sun — approximately 55 seconds",
      notes:
        "FOUNDRY keeps that thread alive by organizing a project into four connected stages. Ideate turns an initial prompt into a brief and requirements. Engineer brings assembly, CAD, circuits, PCB, code, and repository work into the same project. Verify connects checks, evidence, waivers, approvals, and releases. Launch carries approved work into media, a storefront, and commerce. These are not four separate applications. They share the same project, permissions, audit history, files, and AI context. That shared context is the product: a change can move forward without asking the team to reconstruct everything that happened before it.",
      sources: [
        `${sourceRoot}/README.md — Product overview`,
        `${sourceRoot}/apps/web/components/project-shell.tsx`,
      ],
    },
    {
      kind: "content",
      theme: "paper",
      number: 3,
      speaker: "Will Sun",
      section: "Evidence",
      label: "The product presents one coherent system",
      body: `
        <div class="evidence-split">
          <div class="evidence-copy">
            <p class="eyebrow">01 / PRODUCT EVIDENCE</p>
            <h2>The product already speaks one visual language.</h2>
            <p class="lede">The public entrance establishes the same four-stage model used inside every project.</p>
            <div class="evidence-lines">
              <p><span>01</span>Accounts, workspaces, projects, and folders</p>
              <p><span>02</span>Four complete product stages</p>
              <p><span>03</span>Chat, presence, permissions, and audit</p>
            </div>
            <a class="live-link" href="https://foundry-web-3wiy.onrender.com/" target="_blank" rel="noreferrer">LIVE PRODUCT <b>↗</b></a>
          </div>
          <figure class="landing-proof" aria-label="FOUNDRY deployed homepage reconstruction">
            <div class="landing-top"><b><img src="assets/foundry-logo.png" alt=""/> FOUNDRY</b><span>CREATE ACCOUNT&nbsp;&nbsp;&nbsp; SIGN IN</span></div>
            <div class="landing-main">
              <div class="landing-orange"><canvas class="glyph-field" data-seed="landing-page" data-cols="28" data-rows="22"></canvas><small>IDEATE · ENGINEER · VERIFY · LAUNCH</small></div>
              <div class="landing-copy"><small>HARDWARE OS</small><h3>Describe it.<br/>Engineer it. Build it.<br/>Sell it.</h3><p>An AI-native workspace that carries one physical product from a sentence to a manufacturable release.</p>
                <div class="landing-stages"><span>01 IDEATE</span><span>02 ENGINEER</span><span>03 VERIFY</span><span>04 LAUNCH</span></div>
              </div>
            </div>
            <figcaption>DEPLOYED EXPERIENCE · RECONSTRUCTED FROM CURRENT HOME-SHELL</figcaption>
          </figure>
        </div>`,
      footer: ["FOUNDRY", "WILL SUN · EVIDENCE", "03 / 12"],
      noteTitle: "Will Sun — approximately 55 seconds",
      notes:
        "This is an HTML reconstruction of the deployed FOUNDRY homepage, built from the current home component rather than a presentation mockup. The product introduces the four stages immediately and uses the same visual system that continues inside the application: sharp edges, signal orange, dot matrices, and dense technical information without a generic dashboard feel. That consistency matters because the user should not feel that Ideate, Engineer, Verify, and Launch are unrelated modules. The public product communicates one promise: describe it, engineer it, build it, and sell it without losing the thread. The remaining slides show how the implementation delivers that promise behind the interface.",
      sources: [
        "https://foundry-web-3wiy.onrender.com/",
        `${sourceRoot}/apps/web/components/home-shell.tsx`,
      ],
    },
    {
      kind: "content",
      theme: "dark",
      number: 4,
      speaker: "Alan Shen",
      section: "Method",
      label: "FOUNDRY modular architecture",
      body: `
        <div class="slide-pad">
          <header class="slide-header compact"><p class="eyebrow">02 / IMPLEMENTATION METHOD</p><h2>One application, explicit service boundaries.</h2></header>
          <div class="architecture-stack">
            <div class="stack-line"><span>SURFACE</span><strong>Next.js workspace</strong><small>Ideate · Engineer · Verify · Launch · Chat</small></div><i>↓</i>
            <div class="stack-line"><span>CONTROL</span><strong>tRPC + domain rules</strong><small>Capabilities · states · audit · typed contracts</small></div><i>↓</i>
            <div class="stack-line"><span>BOUNDARY</span><strong>Service ports</strong><small>Auth · Storage · CAD · Media · Sites · Commerce</small></div><i>↓</i>
            <div class="stack-line"><span>RUNTIME</span><strong>Postgres + Redis + workers</strong><small>Prisma · BullMQ · Hocuspocus · Render</small></div>
          </div>
          <p class="architecture-claim">Vendor SDKs stop at the boundary. <span>Product rules remain ours.</span></p>
        </div>`,
      footer: ["FOUNDRY", "ALAN SHEN · METHOD", "04 / 12"],
      noteTitle: "Alan Shen — approximately 55 seconds",
      notes:
        "We implemented FOUNDRY as a TypeScript modular monolith. The user sees one Next.js application, while tRPC and the domain layer enforce permissions, stage rules, and audit events. External systems are isolated behind typed ports: Supabase for identity and storage, Zoo for CAD, OpenAI for media and the copilot, v0 for storefronts, and Shopify for checkout. PostgreSQL stores the product state, Redis and BullMQ handle background work, and Hocuspocus supports collaborative editing. This architecture kept four workstreams integrable and made vendor behavior replaceable without moving product rules into SDK code.",
      sources: [
        `${sourceRoot}/AGENTS.md — Current architecture`,
        `${sourceRoot}/README.md — Architecture`,
        `${sourceRoot}/render.yaml`,
      ],
    },
    {
      kind: "content",
      theme: "paper",
      number: 5,
      speaker: "Alan Shen",
      section: "Copilot",
      label: "Project-aware AI copilot",
      body: `
        <div class="slide-pad ui-slide">
          <header class="slide-header compact"><p class="eyebrow">02 / AI COLLABORATION</p><h2>The copilot works inside the project—not beside it.</h2></header>
          <div class="app-window">
            <div class="window-top"><b><img src="assets/foundry-logo.png" alt=""/> FOUNDRY</b><span>ENVIRONMENT MONITOR / PROJECT CHAT</span><em>RUNNING</em></div>
            <div class="chat-layout">
              <nav class="channel-rail"><small>PROJECT</small><b># general</b><span># requirements</span><span># hardware</span><span># firmware</span><span># launch</span><i></i><small>MEMBERS</small><span>● Will</span><span>● Alan</span><span>● Jason</span><span>● Zhiheng</span></nav>
              <div class="message-stream">
                <div class="message"><span class="avatar">W</span><div><b>Will Sun <time>10:14</time></b><p>Update the sensing brief for outdoor use.</p></div></div>
                <div class="message ai-message"><span class="avatar ai">AI</span><div><b>FOUNDRY COPILOT <time>10:14</time></b><p>I updated the operating range and identified enclosure, power, and validation work affected by the change.</p><div class="tool-event"><span>TOOL RESULT</span><b>3 project records updated</b></div><small>✓ 3 &nbsp; ↩ REPLY</small></div></div>
                <div class="message"><span class="avatar">J</span><div><b>Jason Xiao <time>10:16</time></b><p>Keep the current enclosure volume as a constraint.</p></div></div>
                <div class="chat-composer"><span>Message #general · use @AI for the project copilot</span><b>↑</b></div>
              </div>
              <aside class="run-rail"><small>ACTIVE RUN</small><h3>Requirements update</h3><span>● Context loaded</span><span>● Project queried</span><b>◉ Changes streaming</b><span>○ Persist result</span><i>heartbeat 6s ago</i></aside>
            </div>
          </div>
          <p class="page-caption">PRODUCT VIEW · messages, replies, reactions, tools, and recoverable runs</p>
        </div>`,
      footer: ["FOUNDRY", "ALAN SHEN · COPILOT", "05 / 12"],
      noteTitle: "Alan Shen — approximately 60 seconds",
      notes:
        "The copilot is part of the project workspace rather than a separate prompt box. It can read project context, call scoped tools, and stream results back into persistent channels. Messages retain their authors, users can reply and react, and long work runs in a background queue. We added cancellation, heartbeat, retry, duplicate delivery protection, orphan-run recovery, and transcript merging so a page refresh does not erase the result. This interface is reconstructed directly from the current chat components. The point is not only that AI can generate text; it can participate in the same accountable project history as the team.",
      sources: [
        `${sourceRoot}/apps/web/components/copilot/discord-chat.tsx`,
        `${sourceRoot}/apps/web/components/copilot/message-actions.tsx`,
        `${sourceRoot}/apps/web/worker/chat-run-worker.ts`,
      ],
    },
    {
      kind: "content",
      theme: "dark",
      number: 6,
      speaker: "Alan Shen",
      section: "Engineer",
      label: "Multidisciplinary engineer workspace",
      body: `
        <div class="slide-pad ui-slide">
          <header class="slide-header compact"><p class="eyebrow">02 / ENGINEER</p><h2>Mechanical, electrical, and software work share one frame.</h2></header>
          <div class="app-window engineer-window">
            <div class="window-top dark-top"><b><img src="assets/foundry-logo.png" alt=""/> FOUNDRY</b><span>ENVIRONMENT MONITOR / ENGINEER</span><em>SYNCED</em></div>
            <div class="engineer-layout">
              <nav class="artifact-rail"><small>PRODUCT</small><b>▾ Assembly</b><span class="active">◈ Product preview</span><span>□ Enclosure</span><span>□ Sensor mount</span><small>ELECTRONICS</small><span>⌁ Schematic</span><span>▦ PCB layout</span><small>SOFTWARE</small><span>⌘ Repository</span><span>{ } Firmware</span></nav>
              <div class="cad-viewport"><div class="viewport-grid"></div><div class="cad-product"><span class="screen"></span><span class="grill"></span><i class="label l1">ENCLOSURE · ABS</i><i class="label l2">PCB ASSEMBLY</i><i class="label l3">SENSOR OPENING</i></div><div class="viewport-toolbar"><span>ORBIT</span><span>PAN</span><span>SECTION</span><b>FIT</b></div></div>
              <aside class="inspector"><small>ASSEMBLY</small><h3>Product preview</h3><p><span>Source</span><b>product.kcl</b></p><p><span>Parts</span><b>4 linked</b></p><p><span>Viewport</span><b>LIVE</b></p><small>BOM SUMMARY</small><p><span>BME280</span><b>1</b></p><p><span>ESP32-C3</span><b>1</b></p><p><span>LiPo 3000</span><b>1</b></p><p><span>ABS housing</span><b>2</b></p></aside>
            </div>
          </div>
          <p class="page-caption dark-caption">PRODUCT VIEW · assembly, CAD, schematic, PCB, repository, code, BOM</p>
        </div>`,
      footer: ["FOUNDRY", "ALAN SHEN · ENGINEER", "06 / 12"],
      noteTitle: "Alan Shen — approximately 60 seconds",
      notes:
        "Engineer is where FOUNDRY becomes more than project management. The workspace includes assembly, KCL mechanical CAD, schematic and PCB canvases, a repository file tree, Monaco code editing, BOM data, and design documents. Zoo powers live CAD generation and viewport rendering, while entity labels and hover selection make geometry inspectable. Code can synchronize through Yjs and Hocuspocus, with autosave when collaborative service is unavailable. This reconstruction follows the current Assembly and CAD components. The disciplines remain specialized, but they live inside the same product project instead of forcing the team to reassemble the context outside the system.",
      sources: [
        `${sourceRoot}/apps/web/components/stages/engineer-stage.tsx`,
        `${sourceRoot}/apps/web/components/engineer/assembly-view.tsx`,
        `${sourceRoot}/apps/web/components/engineer/cad-viewport.tsx`,
        `${sourceRoot}/apps/web/components/engineer/code-workspace.tsx`,
      ],
    },
    {
      kind: "content",
      theme: "paper",
      number: 7,
      speaker: "Jason Xiao",
      section: "Verify",
      label: "Verification and release decisions",
      body: `
        <div class="slide-pad ui-slide">
          <header class="slide-header compact"><p class="eyebrow">03 / VERIFY</p><h2>Artifacts become a release only after evidence.</h2></header>
          <div class="app-window verify-window">
            <div class="window-top"><b><img src="assets/foundry-logo.png" alt=""/> FOUNDRY</b><span>ENVIRONMENT MONITOR / VERIFY</span><em class="teal">3 / 4 PASS</em></div>
            <div class="verify-layout">
              <div class="verify-list">
                <div class="verify-summary"><strong>75%</strong><div><b>Release readiness</b><small>Evidence reviewed on current branch</small></div></div>
                <div class="check-row pass"><i>✓</i><div><b>Sensor accuracy</b><small>±0.4°C bench result attached</small></div><em>PASS</em></div>
                <div class="check-row pass"><i>✓</i><div><b>Battery runtime</b><small>24-hour field log attached</small></div><em>PASS</em></div>
                <div class="check-row review"><i>!</i><div><b>Ingress protection</b><small>Reviewer waiver requested</small></div><em>REVIEW</em></div>
                <div class="check-row pass"><i>✓</i><div><b>Firmware recovery</b><small>Power-loss test attached</small></div><em>PASS</em></div>
              </div>
              <aside class="release-drawer"><small>RELEASE GATE</small><h3>Candidate 0.9</h3><p><span>Checks</span><b>3 passing</b></p><p><span>Waivers</span><b>1 pending</b></p><p><span>Evidence</span><b>6 files</b></p><p><span>Approver</span><b>Reviewer</b></p><button>REVIEW RELEASE</button><i>Every status change is permission-checked and audited.</i></aside>
            </div>
          </div>
          <p class="page-caption">PRODUCT VIEW · checks, evidence, waivers, approval gate, release record</p>
        </div>`,
      footer: ["FOUNDRY", "JASON XIAO · VERIFY", "07 / 12"],
      noteTitle: "Jason Xiao — approximately 55 seconds",
      notes:
        "Verify turns engineering output into a release decision. A check can record its status, evidence, and reviewer context. Exceptions are visible as waivers rather than silently ignored, and release gates require the right capability before approval. Every protected mutation also creates an audit event. This product-page reconstruction follows the current Verify stage. The important design choice is separation: a polished render or AI result is not engineering evidence. Release readiness depends on checks and approval, so the interface tells the team what has passed, what still needs review, and who is responsible for the final decision.",
      sources: [
        `${sourceRoot}/apps/web/components/stages/verify-stage.tsx`,
        `${sourceRoot}/apps/web/server/routers/verify.ts`,
        `${sourceRoot}/packages/db/prisma/schema.prisma`,
      ],
    },
    {
      kind: "content",
      theme: "dark",
      number: 8,
      speaker: "Jason Xiao",
      section: "Launch",
      label: "Launch media, site, and checkout",
      body: `
        <div class="slide-pad ui-slide">
          <header class="slide-header compact"><p class="eyebrow">03 / LAUNCH</p><h2>The approved product becomes a sellable story.</h2></header>
          <div class="launch-composition">
            <nav class="launch-rail"><small>LAUNCH WORKSPACE</small><b>Media library</b><b>Storefront</b><b>Commerce</b><i></i><span>RELEASE</span><em>Candidate 0.9</em></nav>
            <div class="media-wall"><div class="hero-media"><div class="product-render"><span></span><i></i></div><small>HERO · APPROVED</small></div><div class="media-a"><small>DETAIL · READY</small></div><div class="media-b"><small>FIELD · READY</small></div></div>
            <div class="site-preview"><div class="site-browser">● ● ● &nbsp;&nbsp; preview.v0.dev/environment-monitor</div><div class="storefront"><div><small>FIELD INTELLIGENCE</small><h3>Know the air.<br/>Trust the signal.</h3><p>Weather-ready sensing with 24-hour battery life.</p><button>PREORDER · $149</button></div><div class="store-device"><span></span></div></div><footer><span>SHOPIFY CONNECTED</span><b>LISTING READY</b><em>HOSTED CHECKOUT ↗</em></footer></div>
          </div>
          <p class="page-caption dark-caption">PRODUCT VIEW · generated media, v0 storefront, Shopify listing and checkout</p>
        </div>`,
      footer: ["FOUNDRY", "JASON XIAO · LAUNCH", "08 / 12"],
      noteTitle: "Jason Xiao — approximately 60 seconds",
      notes:
        "Launch carries a verified release into a public product story. The media library can generate still images and video through an asynchronous job, track approval separately from engineering verification, and attach approved assets to a site. The v0 adapter creates, previews, edits, and deploys the storefront. Shopify provides the listing and hosted checkout, with credentials stored per site because each workspace may sell through a different store. This view combines the current media, site editor, and commerce components. The result is that launch data stays connected to the same release instead of becoming unrelated marketing copy.",
      sources: [
        `${sourceRoot}/apps/web/components/stages/launch-stage.tsx`,
        `${sourceRoot}/apps/web/components/media/media-library.tsx`,
        `${sourceRoot}/apps/web/components/sites/site-editor-workspace.tsx`,
        `${sourceRoot}/apps/web/components/sites/commerce-panel.tsx`,
      ],
    },
    {
      kind: "content",
      theme: "paper",
      number: 9,
      speaker: "Jason Xiao",
      section: "Difficulties",
      label: "External-service failures are bounded",
      body: `
        <div class="slide-pad">
          <header class="slide-header"><p class="eyebrow">03 / DIFFICULTIES + RESPONSE</p><h2>External failure never gets to impersonate success.</h2></header>
          <div class="failure-boundary">
            <div><small>UNAVAILABLE</small><strong>Zoo</strong><strong>OpenAI</strong><strong>v0</strong><strong>Shopify</strong><p>timeouts · missing keys · retries · malformed output</p></div>
            <div class="boundary-gate"><small>PORT</small><b>typed contract</b><b>capability gate</b><b>audit event</b><b>job recovery</b><i></i></div>
            <div><small>BOUNDED RESULT</small><strong>LOCAL</strong><strong>SIMULATED</strong><strong>UNVERIFIED</strong><p>Visible status. No silent publish. No false evidence.</p></div>
          </div>
          <div class="difficulty-result"><span>DESIGN PRINCIPLE</span><strong>Degrade the capability—not the truth.</strong></div>
        </div>`,
      footer: ["FOUNDRY", "JASON XIAO · DIFFICULTIES", "09 / 12"],
      noteTitle: "Jason Xiao — approximately 55 seconds",
      notes:
        "Our biggest engineering difficulty was coordinating services that are slow, credential-dependent, and sometimes unavailable. CAD, media generation, site building, and checkout all have different failure modes. We addressed this with explicit ports, background jobs, retries, heartbeat recovery, and strict status boundaries. When a real provider is unavailable, local or simulated behavior is visibly labeled. Simulated media cannot be approved or attached to a site, and a simulated site cannot publish. The system can therefore keep the development experience usable without telling the user that a mocked result is real. We degrade the capability, not the truth.",
      sources: [
        `${sourceRoot}/AGENTS.md — Hard rules and service boundaries`,
        `${sourceRoot}/packages/media`,
        `${sourceRoot}/packages/sites`,
        `${sourceRoot}/packages/cad`,
      ],
    },
    {
      kind: "content",
      theme: "dark",
      number: 10,
      speaker: "Zhiheng Li",
      section: "Process",
      label: "Final sprint process",
      body: `
        <div class="slide-pad">
          <header class="slide-header compact"><p class="eyebrow">04 / FINAL BUILD PROCESS</p><h2>The last sprint closed the integration loop.</h2></header>
          <div class="commit-trace"><div class="commit-line"></div>
            <article class="c1"><span>9e3bb9a</span><strong>Media + CAD preview</strong><small>Product assets, profile, labels</small></article>
            <article class="c2"><span>32e6108</span><strong>Human chat</strong><small>Authors, replies, reactions</small></article>
            <article class="c3"><span>2082f38</span><strong>Repository restored</strong><small>Project files return to Engineer</small></article>
            <article class="c4"><span>8ffa8dd</span><strong>Everything connected</strong><small>Async media jobs + final integration</small></article>
          </div>
          <div class="delta-readout"><div><strong>4</strong><span>final commits</span></div><div><strong>93</strong><span>files changed</span></div><div><strong>+7,596</strong><span>lines added</span></div><div><strong>−595</strong><span>lines removed</span></div></div>
        </div>`,
      footer: ["FOUNDRY", "ZHIHENG LI · PROCESS", "10 / 12"],
      noteTitle: "Zhiheng Li — approximately 55 seconds",
      notes:
        "The final sprint was not another isolated feature push. It closed integration gaps across the product. The first commit added product media, CAD preview assembly, profile support, and viewport labels. The second made collaboration human by attributing messages and adding replies and reactions. The third restored the Repository workspace after it was removed during integration. The final commit connected media generation to asynchronous jobs and completed the final merge. Across those four commits, ninety-three files changed. The important result is that product surfaces that previously existed as separate slices now participate in the same workflow.",
      sources: [
        "Local Git history at final commit 8ffa8dd2d2ef4270dc72ff0a3fcde2da5df09df4",
        `${sourceRoot}/README.md`,
      ],
    },
    {
      kind: "content",
      theme: "paper",
      number: 11,
      speaker: "Zhiheng Li",
      section: "Results",
      label: "One project survives the complete journey",
      body: `
        <div class="slide-pad">
          <header class="slide-header compact"><p class="eyebrow">04 / RESULTS</p><h2>One project now survives the complete journey.</h2></header>
          <div class="journey-page"><nav><b><img src="assets/foundry-logo.png" alt=""/> FOUNDRY</b><strong>ENVIRONMENT MONITOR</strong><span>PROJECT / MAIN</span></nav><aside><span class="active">01</span><span>02</span><span>03</span><span>04</span></aside><main>
            <article class="ideate"><small>IDEATE</small><strong>A sentence becomes a brief.</strong><span>12 requirements · 3 open questions</span></article>
            <article class="engineer"><small>ENGINEER</small><strong>The brief becomes a product.</strong><span>Assembly · CAD · PCB · code · repository</span></article>
            <article class="verify"><small>VERIFY</small><strong>The product earns a release.</strong><span>Checks · evidence · waiver · approval</span></article>
            <article class="launch"><small>LAUNCH</small><strong>The release becomes a storefront.</strong><span>Media · site · listing · hosted checkout</span></article>
          </main></div>
          <div class="platform-band"><b>SHARED PLATFORM</b><span>accounts · workspaces · projects · branches · folders · invitations · permissions · presence · chat · background jobs · audit</span></div>
          <div class="result-inventory"><span><b>31</b> data models</span><span><b>19</b> app routers</span><span><b>59</b> test files</span><span><b>474</b> test declarations</span></div>
        </div>`,
      footer: ["FOUNDRY", "ZHIHENG LI · RESULTS", "11 / 12"],
      noteTitle: "Zhiheng Li — approximately 55 seconds",
      notes:
        "The result is one project that can survive the whole journey. Ideate stores the brief and requirements. Engineer turns that intent into mechanical, electrical, and software artifacts. Verify records the evidence and release decision. Launch converts the release into media, a site, a listing, and checkout. Under that journey are thirty-one database models, nineteen application routers, and fifty-nine test files containing roughly four hundred seventy-four test declarations. Those numbers are not the product by themselves; they show the implementation depth behind the visible workflow. Our real result is continuity: the project remains recognizable from the first sentence to the storefront.",
      sources: [
        `${sourceRoot}/packages/db/prisma/schema.prisma`,
        `${sourceRoot}/apps/web/server/routers`,
        "Static repository inventory inspected 2026-07-29",
      ],
    },
    {
      kind: "content",
      theme: "dark",
      number: 12,
      speaker: "Zhiheng Li",
      section: "Demo",
      label: "Eight-minute live demonstration relay",
      body: `
        <div class="slide-pad">
          <header class="slide-header compact"><p class="eyebrow">04 / LIVE DEMO RELAY</p><h2>Eight minutes. Four owners. One uninterrupted project.</h2></header>
          <div class="demo-route"><div class="demo-axis"></div>
            <article class="d1"><time>00:00—02:00</time><span>01</span><strong>Will · Ideate</strong><p>Open the workspace. Turn the product prompt into requirements.</p></article>
            <article class="d2"><time>02:00—04:00</time><span>02</span><strong>Alan · Copilot + Engineer</strong><p>Ask the project-aware AI, then inspect assembly, CAD, PCB, and code.</p></article>
            <article class="d3"><time>04:00—06:00</time><span>03</span><strong>Jason · Verify</strong><p>Attach evidence, review the waiver, and prepare the release.</p></article>
            <article class="d4"><time>06:00—08:00</time><span>04</span><strong>Zhiheng · Launch</strong><p>Approve media, open the storefront, and show the checkout handoff.</p></article>
          </div>
          <div class="demo-safety"><span>LIVE PATH</span><strong>Preloaded project · deterministic starting state · no audience setup</strong></div>
        </div>`,
      footer: ["FOUNDRY", "ZHIHENG LI · DEMO", "12 / 12"],
      noteTitle: "Zhiheng Li — approximately 55 seconds, then demo",
      notes:
        "Our live demo uses the same project from start to finish and gives every member an equal two-minute segment. Will opens the workspace and updates the brief. Alan shows the project-aware copilot and the Engineer surfaces. Jason attaches evidence and prepares a release. I finish by showing approved media, the storefront, and the checkout handoff. We will use a preloaded project with a deterministic starting state, so the audience sees the workflow rather than setup time. Together with three minutes of slides per person, this gives each member approximately five minutes of the twenty-minute presentation.",
      sources: [
        "Professor-provided final presentation guidelines — time allocation and live demo guidance",
        `${sourceRoot}/README.md — product workflow`,
      ],
    },
    {
      kind: "closing",
      theme: "closing",
      speaker: "Shared close",
      section: "Closing",
      label: "FOUNDRY closing slide",
      body: `
        <div class="closing-signal"><canvas class="glyph-field" data-seed="foundry-final-closing" data-cols="40" data-rows="25"></canvas><span>KEEP THE PULSE.</span></div>
        <div class="closing-copy"><p class="eyebrow">FOUNDRY</p><h2>The product stays connected<br/>because the project does.</h2><p>Describe it. Engineer it. Build it. Sell it.</p><a href="https://foundry-web-3wiy.onrender.com/" target="_blank" rel="noreferrer">foundry-web-3wiy.onrender.com <b>↗</b></a></div>`,
      footer: ["FOUNDRY", "LIVE DEMO", "READY"],
      noteTitle: "Transition to demo — 15 seconds",
      notes:
        "FOUNDRY keeps the product connected because it keeps the project connected. We will now show that complete journey live.",
      sources: ["https://foundry-web-3wiy.onrender.com/", `${sourceRoot}/README.md`],
    },
  ];

  const slideRoot = document.querySelector("#slides");

  function escapeSource(value) {
    return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  }

  slideRoot.innerHTML = slideData
    .map(
      (slide, index) => `
        <section
          class="slide ${slide.theme}${index === 0 ? " active" : ""}"
          data-kind="${slide.kind}"
          ${slide.number ? `data-content="${slide.number}"` : ""}
          data-speaker="${slide.speaker}"
          data-section="${slide.section}"
          aria-label="${slide.label}"
        >
          ${slide.body}
          <footer class="footer"><span>${slide.footer[0]}</span><span>${slide.footer[1]}</span><span>${slide.footer[2]}</span></footer>
          <aside class="notes">
            <h2>${slide.noteTitle}</h2>
            <p>${slide.notes}</p>
            <div class="sources">[Sources]\n${slide.sources.map(escapeSource).join("\n")}\n[/Sources]</div>
          </aside>
        </section>`,
    )
    .join("");

  const slides = Array.from(document.querySelectorAll(".slide"));
  const progress = document.querySelector(".progress");
  const notesOverlay = document.querySelector(".notes-overlay");
  const helpOverlay = document.querySelector(".help-overlay");
  const notesContent = document.querySelector(".notes-content");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const pointer = { x: -9999, y: -9999, active: false };
  let index = 0;
  let touchStartX = null;

  const hashIndex = Number.parseInt(window.location.hash.replace("#", ""), 10);
  if (Number.isFinite(hashIndex) && hashIndex >= 1 && hashIndex <= slides.length)
    index = hashIndex - 1;

  function updateSlide(nextIndex) {
    index = Math.max(0, Math.min(slides.length - 1, nextIndex));
    slides.forEach((slide, slideIndex) => {
      slide.classList.toggle("active", slideIndex === index);
      slide.setAttribute("aria-hidden", slideIndex === index ? "false" : "true");
    });
    progress.style.width = `${((index + 1) / slides.length) * 100}%`;
    window.history.replaceState(null, "", `#${index + 1}`);
  }

  function closeOverlays() {
    notesOverlay.classList.remove("open");
    helpOverlay.classList.remove("open");
  }

  function toggleNotes() {
    if (notesOverlay.classList.contains("open")) {
      notesOverlay.classList.remove("open");
      return;
    }
    helpOverlay.classList.remove("open");
    notesContent.innerHTML = slides[index].querySelector(".notes").innerHTML;
    notesOverlay.classList.add("open");
  }

  function toggleHelp() {
    notesOverlay.classList.remove("open");
    helpOverlay.classList.toggle("open");
  }

  document.querySelector(".nav.prev").addEventListener("click", () => updateSlide(index - 1));
  document.querySelector(".nav.next").addEventListener("click", () => updateSlide(index + 1));
  document.querySelector(".help").addEventListener("click", toggleHelp);
  document
    .querySelectorAll(".overlay-close")
    .forEach((button) => button.addEventListener("click", closeOverlays));
  document.querySelectorAll(".overlay").forEach((overlay) =>
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) closeOverlays();
    }),
  );

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") return closeOverlays();
    if (notesOverlay.classList.contains("open") || helpOverlay.classList.contains("open")) {
      if (event.key.toLowerCase() === "n") toggleNotes();
      return;
    }
    if (["ArrowRight", "PageDown", " "].includes(event.key)) {
      event.preventDefault();
      updateSlide(index + 1);
    } else if (["ArrowLeft", "PageUp"].includes(event.key)) {
      event.preventDefault();
      updateSlide(index - 1);
    } else if (event.key === "Home") updateSlide(0);
    else if (event.key === "End") updateSlide(slides.length - 1);
    else if (event.key.toLowerCase() === "n") toggleNotes();
    else if (event.key.toLowerCase() === "f") {
      if (document.fullscreenElement) document.exitFullscreen?.();
      else document.documentElement.requestFullscreen?.();
    } else if (event.key === "?") toggleHelp();
  });

  window.addEventListener(
    "touchstart",
    (event) => {
      touchStartX = event.touches[0]?.clientX ?? null;
    },
    { passive: true },
  );
  window.addEventListener(
    "touchend",
    (event) => {
      if (touchStartX === null) return;
      const delta = (event.changedTouches[0]?.clientX ?? touchStartX) - touchStartX;
      if (Math.abs(delta) > 50) updateSlide(index + (delta < 0 ? 1 : -1));
      touchStartX = null;
    },
    { passive: true },
  );
  window.addEventListener("pointermove", (event) => {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.active = true;
  });
  window.addEventListener("pointerleave", () => {
    pointer.active = false;
  });
  updateSlide(index);

  const glCanvas = document.querySelector("#webgl-field");
  const gl = glCanvas.getContext("webgl", { alpha: true, antialias: false });
  if (gl) {
    const vertexSource = `attribute vec2 a_position;void main(){gl_Position=vec4(a_position,0.0,1.0);}`;
    const fragmentSource = `
      precision mediump float;
      uniform vec2 u_resolution;uniform vec2 u_pointer;uniform float u_time;uniform float u_dark;
      float circle(vec2 p,float r){return 1.0-smoothstep(r-.08,r+.08,length(p));}
      void main(){
        vec2 px=gl_FragCoord.xy;vec2 uv=px/u_resolution.xy;float aspect=u_resolution.x/u_resolution.y;
        vec2 c=(uv-.5)*vec2(aspect,1.);vec2 grid=fract(px/13.)-.5;float dots=circle(grid,.105);
        vec2 pt=u_pointer/u_resolution.xy;pt.y=1.-pt.y;float glow=exp(-length((uv-pt)*vec2(aspect,1.))*8.);
        float wave=sin(c.x*11.-u_time*.6)*cos(c.y*15.+u_time*.42);
        float scan=smoothstep(.82,1.,sin((uv.x+uv.y)*18.-u_time));
        float intensity=dots*(.2+.06*wave+.14*scan+.58*glow);
        vec3 color=mix(vec3(1.,.353,0.),vec3(.957,.949,.925),u_dark*.28);
        gl_FragColor=vec4(color,intensity*mix(.22,.32,u_dark));
      }`;

    function shader(type, source) {
      const value = gl.createShader(type);
      gl.shaderSource(value, source);
      gl.compileShader(value);
      return value;
    }

    const program = gl.createProgram();
    gl.attachShader(program, shader(gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(program);
    const positionLocation = gl.getAttribLocation(program, "a_position");
    const resolutionLocation = gl.getUniformLocation(program, "u_resolution");
    const pointerLocation = gl.getUniformLocation(program, "u_pointer");
    const timeLocation = gl.getUniformLocation(program, "u_time");
    const darkLocation = gl.getUniformLocation(program, "u_dark");
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );

    function renderWebGL(timestamp) {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      glCanvas.width = Math.floor(window.innerWidth * ratio);
      glCanvas.height = Math.floor(window.innerHeight * ratio);
      gl.viewport(0, 0, glCanvas.width, glCanvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(resolutionLocation, glCanvas.width, glCanvas.height);
      gl.uniform2f(
        pointerLocation,
        pointer.active ? pointer.x * ratio : -9999,
        pointer.active ? pointer.y * ratio : -9999,
      );
      gl.uniform1f(timeLocation, reduceMotion ? 0 : timestamp * 0.001);
      gl.uniform1f(
        darkLocation,
        ["dark", "cover", "closing"].some((name) => slides[index].classList.contains(name)) ? 1 : 0,
      );
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      requestAnimationFrame(renderWebGL);
    }
    requestAnimationFrame(renderWebGL);
  }

  const glyphChars = [" ", ".", "0", "1", "/", "\\", ">", "<", ":", "|"];

  function seedHash(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function randomFrom(seed) {
    let state = seed;
    return () => {
      state += 0x6d2b79f5;
      let value = Math.imul(state ^ (state >>> 15), 1 | state);
      value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  const glyphModels = Array.from(document.querySelectorAll(".glyph-field")).map((canvas) => {
    const cols = Number.parseInt(canvas.dataset.cols || "40", 10);
    const rows = Number.parseInt(canvas.dataset.rows || "28", 10);
    const random = randomFrom(seedHash(canvas.dataset.seed || "foundry"));
    const blobs = Array.from({ length: 9 }, () => ({
      x: 0.12 + random() * 0.76,
      y: 0.12 + random() * 0.76,
      radius: 0.1 + random() * 0.24,
      weight: 0.7 + random() * 0.75,
    }));
    const density = Array.from({ length: rows }, (_, row) =>
      Array.from({ length: cols }, (_, col) => {
        const x = (col + 0.5) / cols;
        const y = (row + 0.5) / rows;
        let total = 0;
        blobs.forEach((blob) => {
          const dx = (x - blob.x) / blob.radius;
          const dy = (y - blob.y) / (blob.radius * 0.78);
          total += blob.weight * Math.exp(-(dx * dx + dy * dy));
        });
        return Math.min(1, total * Math.min(1, Math.min(x, 1 - x, y, 1 - y) * 6));
      }),
    );
    return { canvas, cols, rows, density, random };
  });

  function renderGlyphs(timestamp) {
    glyphModels.forEach(({ canvas, cols, rows, density }) => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(rect.width * ratio));
      canvas.height = Math.max(1, Math.floor(rect.height * ratio));
      const context = canvas.getContext("2d");
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, rect.width, rect.height);
      const cellWidth = rect.width / cols;
      const cellHeight = rect.height / rows;
      context.font = `${Math.max(6, Math.min(cellWidth, cellHeight) * 0.78)}px Menlo, monospace`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillStyle = "rgba(255,255,255,.7)";
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          const x = (col + 0.5) * cellWidth;
          const y = (row + 0.5) * cellHeight;
          const distance = Math.hypot(x - (pointer.x - rect.left), y - (pointer.y - rect.top));
          const disturbance = pointer.active ? Math.max(0, 1 - distance / 125) : 0;
          const value =
            density[row][col] +
            Math.sin(col * 0.31 + row * 0.23 + timestamp * 0.0012) * 0.11 +
            disturbance * 0.5;
          if (value < 0.18) continue;
          context.globalAlpha = Math.min(0.82, 0.15 + value * 0.62);
          context.fillText(
            glyphChars[Math.min(glyphChars.length - 1, Math.max(1, Math.floor(value * 8)))],
            x,
            y,
          );
        }
      }
      context.globalAlpha = 1;
    });
    requestAnimationFrame(renderGlyphs);
  }
  requestAnimationFrame(renderGlyphs);
})();
