/**
 * Idempotent seed for local development and e2e tests.
 * Creates two LOCAL users (builder + reviewer), a demo workspace, and a demo
 * project with a main branch and all four stage rows.
 */
import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";

const prisma = new PrismaClient();

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

async function main() {
  const builder = await prisma.user.upsert({
    where: { email: "builder@foundry.local" },
    update: {},
    create: {
      email: "builder@foundry.local",
      name: "Demo Builder",
      localPasswordHash: hashPassword("demo-password"),
    },
  });

  await prisma.user.upsert({
    where: { email: "reviewer@foundry.local" },
    update: {},
    create: {
      email: "reviewer@foundry.local",
      name: "Demo Reviewer",
      localPasswordHash: hashPassword("demo-password"),
    },
  });

  const workspace = await prisma.workspace.upsert({
    where: { slug: "demo-workspace" },
    update: {},
    create: {
      name: "Demo Workspace",
      slug: "demo-workspace",
      createdById: builder.id,
      memberships: { create: { userId: builder.id, role: "OWNER" } },
    },
  });

  const existingProject = await prisma.project.findUnique({
    where: { workspaceId_slug: { workspaceId: workspace.id, slug: "palm-rover" } },
  });

  if (!existingProject) {
    const project = await prisma.project.create({
      data: {
        workspaceId: workspace.id,
        name: "Palm Rover",
        slug: "palm-rover",
        description: "Palm-sized two-wheel autonomous rover (PRD seed demo project).",
        createdById: builder.id,
      },
    });
    const branch = await prisma.projectBranch.create({
      data: { projectId: project.id, name: "main", isDefault: true, createdById: builder.id },
    });
    await prisma.project.update({
      where: { id: project.id },
      data: { activeBranchId: branch.id },
    });
    await prisma.stageState.createMany({
      data: (["IDEATE", "ENGINEER", "VERIFY", "LAUNCH"] as const).map((stage) => ({
        projectId: project.id,
        branchId: branch.id,
        stage,
      })),
    });
    await prisma.auditEvent.create({
      data: {
        type: "ProjectCreated",
        workspaceId: workspace.id,
        projectId: project.id,
        branchId: branch.id,
        actorId: builder.id,
        actorType: "SYSTEM",
        payload: { seed: true, name: project.name },
      },
    });
  }

  await seedEnvironmentalMonitor(workspace.id, builder.id);

  console.log("Seed complete: builder@foundry.local / reviewer@foundry.local (demo-password)");
}

/**
 * The compact environmental monitor from the project proposal, complete enough
 * that impact analysis has something real to traverse.
 *
 * This exists so the demo does not depend on a live model call. A run that
 * needs the copilot to generate a BOM, a schematic and firmware before anything
 * can be shown is a run that fails on stage, on conference wifi, with the
 * judges watching. `pnpm db:seed` reproduces the whole thing offline and
 * deterministically, on any machine.
 *
 * Deliberately NOT seeded: the SATISFIES and IMPLEMENTED_BY edges linking the
 * cell to the runtime requirement and the requirement to src/power.cpp. Those
 * are the links a person or the copilot has to draw, and drawing one live is
 * the clearest way to show what the graph does that a folder of files cannot.
 */
async function seedEnvironmentalMonitor(workspaceId: string, builderId: string) {
  const slug = "environmental-monitor";
  const existing = await prisma.project.findUnique({
    where: { workspaceId_slug: { workspaceId, slug } },
  });
  if (existing) return;

  const project = await prisma.project.create({
    data: {
      workspaceId,
      name: "Environmental Monitor",
      slug,
      description: "Battery-powered temperature and humidity logger (product graph demo).",
      createdById: builderId,
    },
  });
  const branch = await prisma.projectBranch.create({
    data: { projectId: project.id, name: "main", isDefault: true, createdById: builderId },
  });
  await prisma.project.update({
    where: { id: project.id },
    data: { activeBranchId: branch.id },
  });
  await prisma.stageState.createMany({
    data: (["IDEATE", "ENGINEER", "VERIFY", "LAUNCH"] as const).map((stage) => ({
      projectId: project.id,
      branchId: branch.id,
      stage,
      status: stage === "LAUNCH" ? "NOT_STARTED" : "DRAFT",
    })),
  });

  const scope = { projectId: project.id, branchId: branch.id };

  await prisma.projectBrief.create({
    data: {
      ...scope,
      prompt: "A small battery-powered box that logs temperature and humidity indoors.",
      intendedUse: "Indoor air-quality logging in homes and small offices.",
      environment: "Indoor, 0-40 C, non-condensing.",
      targetAudience: "Homeowners and facilities teams.",
      budgetCents: 6000,
      updatedById: builderId,
    },
  });

  await prisma.requirement.createMany({
    data: [
      {
        ...scope,
        title: "Operating time of at least 8 hours per charge",
        description: "The device must survive a working day away from power.",
        type: "ELECTRICAL",
        priority: "MUST",
        minValue: 8,
        unit: "h",
        verificationMethod: "Battery life bench test",
        createdById: builderId,
      },
      {
        ...scope,
        title: "Total mass under 120 g",
        type: "MECHANICAL",
        priority: "SHOULD",
        maxValue: 120,
        unit: "g",
        createdById: builderId,
      },
      {
        ...scope,
        title: "Reports temperature at least once per minute",
        type: "FUNCTIONAL",
        priority: "MUST",
        createdById: builderId,
      },
    ],
  });

  // Power figures are datasheet typicals. The resistor deliberately has none,
  // so the budget check reports itself as incomplete rather than pretending
  // an unknown draw is a zero draw.
  await prisma.component.createMany({
    data: [
      {
        ...scope,
        refDes: "BT1",
        name: "Battery, LiPo 2000 mAh",
        discipline: "ELECTRONICS",
        manufacturer: "Generic",
        quantity: 1,
        unitCostCents: 899,
        capacityMah: 2000,
        nominalVoltageV: 3.7,
        createdById: builderId,
      },
      {
        ...scope,
        refDes: "U1",
        name: "Arduino Nano controller",
        discipline: "ELECTRONICS",
        quantity: 1,
        unitCostCents: 2400,
        currentDrawMa: 19,
        nominalVoltageV: 5,
        createdById: builderId,
      },
      {
        ...scope,
        refDes: "U2",
        name: "BME680 environmental sensor",
        discipline: "ELECTRONICS",
        quantity: 1,
        unitCostCents: 1800,
        currentDrawMa: 4,
        nominalVoltageV: 3.3,
        createdById: builderId,
      },
      {
        ...scope,
        refDes: "D1",
        name: "Status LED indicator",
        discipline: "ELECTRONICS",
        quantity: 1,
        unitCostCents: 20,
        currentDrawMa: 8,
        createdById: builderId,
      },
      {
        ...scope,
        refDes: "R1",
        name: "220R resistor",
        discipline: "ELECTRONICS",
        quantity: 1,
        unitCostCents: 5,
        createdById: builderId,
      },
    ],
  });

  await prisma.designDoc.create({
    data: {
      ...scope,
      kind: "CIRCUIT",
      updatedById: builderId,
      data: {
        version: 2,
        groups: [],
        parts: [
          { id: "u1", type: "wokwi-arduino-uno", label: "U1", x: 0, y: 0 },
          { id: "u2", type: "wokwi-bme680", label: "U2", x: 240, y: 0 },
          { id: "d1", type: "wokwi-led", label: "D1", x: 120, y: 160 },
          { id: "r1", type: "wokwi-resistor", label: "R1", x: 60, y: 160 },
          { id: "bt1", type: "wokwi-battery", label: "BT1", x: 0, y: 280 },
        ],
        wires: [
          {
            id: "w1",
            from: { part: "u1", pin: "2" },
            to: { part: "r1", pin: "1" },
            label: "LED_CTRL",
          },
          {
            id: "w2",
            from: { part: "r1", pin: "2" },
            to: { part: "d1", pin: "A" },
            label: "LED_A",
          },
          {
            id: "w3",
            from: { part: "d1", pin: "C" },
            to: { part: "u1", pin: "GND.1" },
            label: "GND",
          },
          {
            id: "w4",
            from: { part: "u1", pin: "5V" },
            to: { part: "u2", pin: "VCC" },
            label: "VCC",
          },
          {
            id: "w5",
            from: { part: "u2", pin: "SDA" },
            to: { part: "u1", pin: "A4" },
            label: "I2C_SDA",
          },
          {
            id: "w6",
            from: { part: "bt1", pin: "+" },
            to: { part: "u1", pin: "VIN" },
            label: "VBAT",
          },
          {
            id: "w7",
            from: { part: "bt1", pin: "-" },
            to: { part: "u1", pin: "GND.2" },
            label: "GND",
          },
        ],
      },
    },
  });

  // A board for the demo: the LED and its resistor bound to their schematic
  // parts, and a pin header — the tallest part, and the one the height check
  // is really about.
  await prisma.designDoc.create({
    data: {
      ...scope,
      kind: "PCB",
      updatedById: builderId,
      data: {
        version: 2,
        activeBoardId: "board-1",
        boards: [
          {
            version: 1,
            id: "board-1",
            name: "Main board",
            board: { widthMm: 70, heightMm: 45, thicknessMm: 1.6, cornerRadiusMm: 2 },
            footprints: [
              {
                id: "fp-r1",
                libraryId: "R_0603",
                refDes: "R1",
                value: "220",
                xMm: 20,
                yMm: 15,
                rotationDeg: 0,
                side: "front",
                partId: "r1",
              },
              {
                id: "fp-d1",
                libraryId: "LED_0805",
                refDes: "D1",
                xMm: 28,
                yMm: 15,
                rotationDeg: 0,
                side: "front",
                partId: "d1",
              },
              {
                id: "fp-j1",
                libraryId: "PinHeader_1x04",
                refDes: "J1",
                xMm: 50,
                yMm: 30,
                rotationDeg: 0,
                side: "front",
              },
            ],
            tracks: [],
            vias: [],
            zones: [],
            rules: {},
          },
        ],
      },
    },
  });

  await prisma.designDoc.create({
    data: {
      ...scope,
      kind: "MODEL3D",
      updatedById: builderId,
      // Shape must satisfy normalizeCadDoc (packages/cad): a v5 doc carries
      // engine, activeId and the `script` compat mirror, and a doc missing
      // them is discarded and replaced with a default single part.
      data: {
        version: 5,
        engine: "zoo",
        activeId: "cad-product",
        script: [
          'import "parts/enclosure.kcl" as enclosure',
          'import "parts/battery-bay.kcl" as battery_bay',
          'import "parts/sensor-window.kcl" as sensor_window',
          "",
        ].join("\n"),
        components: [
          {
            id: "cad-enclosure",
            kind: "part",
            name: "enclosure",
            path: "parts/enclosure.kcl",
            // Declared dimensions are what the enclosure fit check reads, and
            // what the model editor shows as sliders. Drag width below 74 and
            // the fit check reports the board no longer fits.
            content: [
              "@settings(defaultLengthUnit = mm)",
              "",
              "width = 90",
              "length = 60",
              "height = 30",
              "wallThickness = 2",
              "standoffHeight = 3",
              "",
              "shell = startSketchOn(XY)",
              "",
            ].join("\n"),
          },
          {
            id: "cad-battery-bay",
            kind: "part",
            name: "battery bay",
            path: "parts/battery-bay.kcl",
            content: "// holds the 2000 mAh cell\nbay = startSketchOn(XY)\n",
          },
          {
            id: "cad-sensor-window",
            kind: "part",
            name: "sensor window",
            path: "parts/sensor-window.kcl",
            content: "// vent over the BME680\nwindow = startSketchOn(XY)\n",
          },
          {
            id: "cad-product",
            kind: "assembly",
            name: "product",
            path: "assembly/product.kcl",
            content: [
              'import "parts/enclosure.kcl" as enclosure',
              'import "parts/battery-bay.kcl" as battery_bay',
              'import "parts/sensor-window.kcl" as sensor_window',
              "",
            ].join("\n"),
          },
        ],
        assets: [],
      },
    },
  });

  const repo = await prisma.repoLink.create({
    data: {
      ...scope,
      role: "FIRMWARE",
      url: "https://github.com/example/environmental-monitor",
      createdById: builderId,
    },
  });

  await prisma.codeFile.createMany({
    data: [
      {
        ...scope,
        repoId: repo.id,
        path: "src/main.cpp",
        updatedById: builderId,
        content: [
          "// Blinks the status LED once per sample period.",
          "// The BME680 on A4/A5 is wired but not yet read — the fit check",
          "// reports that, and it is a real gap rather than a staged one.",
          "const int STATUS_LED = 2;",
          "",
          "void setup() {",
          "  pinMode(STATUS_LED, OUTPUT);",
          "  Serial.begin(9600);",
          "}",
          "",
          "void loop() {",
          "  digitalWrite(STATUS_LED, HIGH);",
          "  delay(200);",
          "  digitalWrite(STATUS_LED, LOW);",
          "  delay(800);",
          "}",
          "",
        ].join("\n"),
      },
      {
        ...scope,
        repoId: repo.id,
        path: "src/power.cpp",
        updatedById: builderId,
        content: [
          "// Sleep scheduling and the battery fuel gauge.",
          "// The duty cycle here is what the 8 hour runtime budget assumes.",
          "const unsigned long SAMPLE_INTERVAL_MS = 60000;",
          "",
        ].join("\n"),
      },
    ],
  });

  await prisma.validationCheck.createMany({
    data: [
      {
        ...scope,
        category: "ELECTRICAL",
        title: "Battery life bench test",
        detail: "Run from full charge to cutoff and record elapsed hours.",
        targetPath: "BT1",
        severity: "MAJOR",
        createdById: builderId,
      },
      {
        ...scope,
        category: "MECHANICAL",
        title: "Enclosure fit inspection",
        detail: "Confirm the printed shell closes with the board and cell installed.",
        targetPath: "parts/enclosure/main.kcl",
        severity: "MINOR",
        createdById: builderId,
      },
    ],
  });

  await prisma.auditEvent.create({
    data: {
      type: "ProjectCreated",
      workspaceId,
      projectId: project.id,
      branchId: branch.id,
      actorId: builderId,
      actorType: "SYSTEM",
      payload: { seed: true, name: project.name },
    },
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
