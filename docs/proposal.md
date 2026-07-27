---
title: "FOUNDRY: An AI-Native Collaborative Platform for Physical Product Development"
subtitle: "Final Project Proposal"
---

**Group members:** Will Sun, Jason Xiao, Alan Shen, Zhiheng Li

---

## 1. Project Goal

FOUNDRY is a collaborative web platform that turns a natural-language product idea into a structured, traceable plan for developing a physical product.

Physical-product development forces teams to coordinate research, requirements, electronics, mechanical design, firmware, testing, and manufacturing preparation across tools that do not share a data model. Requirements live in documents, component research lives in browser tabs, firmware lives in Git, and test plans live in spreadsheets. When one decision changes — a different battery, a different sensor — the downstream consequences are discovered late, by hand, or not at all. The cost of that fragmentation is not a missing file; it is a conflicting requirement that nobody noticed.

FOUNDRY addresses this by treating a product as a connected graph rather than a folder of documents. Users define a product idea, generate structured requirements, record design decisions with their rationale, and inspect how those decisions depend on one another. When something changes, the platform identifies what else may need to be revised.

The platform is explicitly designed to support engineering judgement rather than replace it. Every AI contribution enters the project as a reviewable suggestion that a human must accept, edit, or reject. No agent silently modifies a user's work.

Our goal is a functional proof of concept demonstrating that AI-assisted coordination measurably improves traceability and consistency during early-stage hardware development.

## 2. Current Status: An Existing Working Foundation

This proposal does not begin from zero. A working application was built in advance of this submission, which substantially de-risks the schedule. The following exists, runs, and is covered by tests today:

| Capability | Status |
| --- | --- |
| Monorepo, strict TypeScript, linting, CI on every push | Complete |
| Authentication, workspaces, projects, branches, invitations | Complete |
| Capability-based permissions and an append-only audit log | Complete |
| Product brief and structured requirements with full CRUD | Complete |
| AI copilot: 26 tools, background job queue, streamed responses, cancellable runs | Complete |
| Four-stage project workspace (Ideate, Engineer, Verify, Launch) | Complete |
| Schematic capture canvas with a 50-part catalog | Working baseline |
| PCB placement editor with 3D preview | Working baseline |
| Mechanical CAD viewport with natural-language model generation | Working baseline |
| In-browser code editor over project files | Working baseline |
| Verification checklist with waivers and a stage approval gate | Working baseline |
| Immutable release snapshots | Working baseline |

The codebase currently comprises 24 database models, 13 API routers, and 104 automated test cases across 15 test files, with continuous integration enforcing lint, type-check, and test passes.

Being precise about what does **not** yet exist is equally important, because it defines this project's actual work:

- **There is no Product Graph.** Requirements, components, tasks, and tests are stored as flat, unlinked tables. Nothing connects a battery choice to the operating-time requirement that depends on it. This is the platform's central claim and it is unimplemented.
- **There is one general-purpose agent, not specialized roles.** It works well, but it reasons about the whole product at once rather than as coordinated experts.
- **Agent output is applied directly to the database.** The permission and audit layers are enforced, but there is no propose-review-accept step, so the human-review guarantee described in Section 1 is currently an intention rather than a mechanism.
- **There are no automated consistency checks.** The verification stage is a manual checklist; every status is set by a human from a dropdown.
- **There is no GitHub integration.** Repository references are stored as URL strings.
- **There is no comment or discussion model,** and concurrent edits to the same document resolve last-write-wins.

The remaining work is therefore well-bounded and sits in application logic, which is where our group is strongest.

## 3. Project Scope

The prototype delivers one complete workflow end to end rather than partially reproducing professional engineering software.

### 3.1 Committed deliverables

**Structured intake.** A user enters a product idea in natural language. The system produces a structured brief covering target users, use cases, key features, technical requirements, constraints, risks, and initial development tasks.

**The Product Graph.** A typed graph connecting requirements, components, software modules, tasks, risks, and tests. Each node records its provenance — whether it originated from a user, an import, or an agent — so the rationale behind any element remains recoverable. Edges are typed, allowing the system to answer two questions that are currently impossible: *why does this exist?* and *what does this affect?*

**Impact analysis.** Given a change to any node, the system traverses the graph and reports affected downstream elements, marking them as requiring review. For example, changing the battery surfaces its effects on operating time, weight, enclosure volume, cost, power-management firmware, and the associated test cases.

**Three specialized agents.** A Research agent for product and component investigation, a Requirements agent for decomposing intent into verifiable requirements, and a Verification agent for deriving test coverage and detecting inconsistency. Each has a scoped tool set and produces structured output rather than prose.

**A human-review layer.** Agent output is written to a suggestion store as a reviewable change set, presented as a diff, and applied only on explicit user acceptance. Rejected suggestions remain visible rather than disappearing. This is the mechanism that makes the human-oversight claim in Section 1 real, and it is a first-class deliverable rather than a refinement.

**Automated consistency checks.** Four committed checks, each with a deterministic pass/fail result and a link to the graph nodes responsible:

1. Requirements with no linked verification test.
2. Components with no associated software task or driver.
3. Estimated power draw exceeding stated battery capacity.
4. Task dependencies that are incomplete or circular.

Two further checks — conflicting dimensional or weight constraints, and detection of design changes whose downstream elements were never revised — are stretch goals contingent on schedule.

**Collaborative workspace.** Shared project state with editable requirements and tasks, a suggestion review queue, threaded comments on graph nodes, and a visual graph view. Live multi-user presence already exists; concurrent editing will be made safe through optimistic version checks that reject stale writes rather than silently overwriting them.

**GitHub integration.** Generation of issue drafts from software requirements, with each issue traced back to the originating graph node, plus display of basic repository information.

**Project package export.** A single generated document containing the product summary, requirements, preliminary architecture, component list, development tasks, risks, verification plan, manufacturing checklist, and GitHub issue drafts.

### 3.2 Explicitly out of scope

To keep the project achievable we will not build production circuit design, PCB copper routing or design-rule checking, parametric CAD kernels, physical simulation, automated manufacturing workflows, supplier management, or regulatory certification tooling. The existing schematic, PCB, and CAD surfaces are retained as integration points that demonstrate the graph connecting real engineering artifacts; they are not being developed into professional EDA or CAD tools.

We will also not build a real-time collaborative editing engine based on conflict-free replicated data types. This is a substantial infrastructure project on its own, and optimistic locking achieves the property that actually matters for a four-person team: nobody loses work.

## 4. Implementation and Feasibility

### 4.1 Architecture

FOUNDRY is a web application built as a modular monolith: a React frontend with a typed API layer over a PostgreSQL database, with long-running AI work dispatched to background workers and streamed back to the browser. All external services — authentication, object storage, realtime messaging, AI providers, CAD — sit behind interface boundaries, so any one can be substituted without changing application logic. This structure is already in place and tested, which is why the remaining work is additive rather than architectural.

### 4.2 Product Graph implementation

The graph will be stored in PostgreSQL as typed node and edge tables — an adjacency representation — rather than in a dedicated graph database. This is a deliberate choice. The expected graph size for a single product is on the order of hundreds of nodes, where recursive SQL traversal is comfortably fast, and it avoids introducing a second datastore and its operational burden into a two-week schedule. Impact analysis is a bounded-depth traversal from a changed node, which is straightforward to implement, cheap to test, and easy to explain in a demonstration.

### 4.3 Agents and the review boundary

Each agent is defined by an explicit prompt and a restricted tool set. Rather than granting agents write access, tools emit proposed mutations into a suggestion store. A single well-defined boundary between agent output and project state means agent behaviour can be tested deterministically, and it makes the platform's central safety property structural rather than a matter of prompt discipline.

### 4.4 Demonstration product

We will evaluate the system with one worked example: a compact environmental monitoring device comprising sensors, a microcontroller, wireless communication, a battery, an enclosure, and simple firmware. It spans hardware, software, mechanical, and test concerns — enough to exercise cross-domain dependencies genuinely — while remaining small enough to reason about completely. The battery-change scenario described in Section 3.1 provides a concrete, legible demonstration of impact analysis.

### 4.5 Schedule

The plan assumes roughly two weeks of concentrated work across four people.

| Phase | Work |
| --- | --- |
| Week 1, days 1–2 | Graph schema and API; agent role definitions and tool contracts; suggestion store schema. Interfaces between workstreams frozen at the end of day 2. |
| Week 1, days 3–5 | Graph traversal and impact analysis; three agents producing structured output; suggestion review UI; first two consistency checks. |
| Week 1, day 5 | **Milestone: vertical slice.** An idea produces requirements, which appear as reviewable suggestions and land in the graph. |
| Week 2, days 1–3 | Graph visualization; remaining checks; GitHub issue generation; comments; optimistic locking. |
| Week 2, day 3 | **Milestone: feature complete.** Scope freeze; only bug fixes thereafter. |
| Week 2, days 4–5 | Export generation, end-to-end demonstration rehearsal, report and presentation. |

The day-2 interface freeze and the day-3 scope freeze in week 2 are the two mechanisms that keep four people working in parallel without blocking one another or discovering integration problems too late to fix.

### 4.6 Why this is feasible

Three factors make the timeline credible. The infrastructure the project depends on — authentication, permissions, persistence, the agent runtime, the job queue, streaming, and the test and CI harness — is already built and working, so no time is spent on foundations. The remaining work is application logic in a single language across one codebase, matching our group's strengths in software and AI. And the scope is deliberately bounded to a graph, three agents, a review layer, four checks, and one export, each of which is independently demonstrable, so partial completion still produces a coherent result.

## 5. Division of Responsibilities

Each member owns one vertical workstream end to end — schema through API through interface — so that ownership is unambiguous and no two people edit the same code for the same reason. Workstreams communicate through interfaces agreed and frozen on day 2.

| Member | Primary workstream | Specific ownership |
| --- | --- | --- |
| **Will Sun** | Product Graph and impact analysis | Node and edge schema; provenance recording; traversal and impact-analysis queries; staleness propagation; graph API. Also owns the final end-to-end demonstration script and the written report and presentation. |
| **Alan Shen** | Agent system and platform architecture | Agent role definitions, prompts, and tool contracts; the suggestion store and propose-review-apply pipeline; agent orchestration, model selection, and parallelism; overall architecture, code review, and CI health. |
| **Jason Xiao** | Frontend workspace and visualization | Graph visualization; requirement, task, and component editors; suggestion review and diff interface; comment threads; presentation of check results. |
| **Zhiheng Li** | Checks engine, GitHub, and export | The four automated consistency checks and their result model; GitHub issue generation and repository display; project package export; optimistic locking for concurrent edits. |

**Shared responsibilities.** Every member writes tests for their own workstream and reviews at least one other member's pull requests. Integration issues at a boundary are resolved jointly by the two owners rather than escalated.

**Coordination.** A short daily written standup covering progress, blockers, and any interface change requests. Interface changes after day 2 require agreement from both affected owners. All work goes through pull requests against a protected main branch with CI required to pass.

**Rationale for this allocation.** Alan built the existing application and therefore owns the agent runtime and architecture, where familiarity with the codebase matters most. Will's workstream is the project's intellectual centre and is closest to the data modelling and evaluation work he is strongest in. The frontend and the checks-and-export workstreams are the two most self-contained areas, each with clear inputs and testable outputs, making them well suited to parallel development with minimal coupling.

## 6. Evaluation and Success Criteria

The prototype is successful if a user can complete the following sequence unaided:

1. Enter a product idea in natural language and receive a structured brief.
2. Obtain generated requirements from at least three distinct agent roles, presented as reviewable suggestions.
3. Accept, edit, and reject suggestions, with rejections remaining visible.
4. View the resulting Product Graph and trace any element to its origin.
5. Change a component and receive a correct list of affected downstream elements.
6. Run the consistency checks and see failures linked to the responsible nodes.
7. Generate GitHub issue drafts traceable to their originating requirements.
8. Export a complete project package.

Correctness of impact analysis will be measured against a hand-constructed dependency set for the demonstration product: we will verify that the traversal reports no false negatives on that reference set. Each consistency check will be covered by unit tests using fixtures with known defects.

## 7. Risks and Backup Plan

The scope is arranged so that difficult components degrade to simpler ones without abandoning the central idea.

| Risk | Fallback |
| --- | --- |
| Multi-agent coordination proves unstable | Replace concurrent agents with a fixed sequential pipeline in which each stage consumes the previous stage's structured output. The three roles remain; only the orchestration simplifies. |
| Graph traversal or impact analysis proves too complex | Reduce to single-hop dependency lookup, which still demonstrates traceability, and present multi-hop propagation as future work. |
| Graph visualization proves difficult to build well | Present the graph as linked tables and dependency lists. The underlying model and analysis are unaffected. |
| Concurrent editing causes data loss | Fall back to explicit document locking, or to per-user drafts merged on save. |
| GitHub API integration cannot be completed | Generate downloadable and copyable issue templates instead of creating issues directly. |
| Automated checks prove unreliable | Narrow to the two most deterministic checks — requirement-to-test coverage and task dependency completeness — rather than shipping checks that produce false results. |
| A member is blocked or unavailable | Because each workstream is independently demonstrable, remaining members absorb the highest-value incomplete item. The day-2 interface freeze ensures no workstream is a hard prerequisite for another. |

**Minimum viable outcome.** Even if every fallback above is exercised, the delivered prototype will still allow a user to enter a product idea, generate structured requirements through multiple AI roles, review and edit those suggestions before they are applied, inspect dependencies between project elements, run consistency checks, and export a complete development report. That result still demonstrates the thesis: that a shared, traceable product model with human-reviewed AI assistance materially improves coordination in early-stage hardware development.
