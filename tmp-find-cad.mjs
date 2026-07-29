import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

async function main() {
  const projects = await p.project.findMany({
    orderBy: { updatedAt: "desc" },
    take: 10,
    select: { id: true, name: true, slug: true, updatedAt: true },
  });
  console.log("projects", JSON.stringify(projects, null, 2));

  for (const proj of projects.slice(0, 5)) {
    const docs = await p.designDoc.findMany({
      where: { projectId: proj.id, kind: "MODEL3D" },
      select: { id: true, title: true, content: true, updatedAt: true },
      take: 1,
      orderBy: { updatedAt: "desc" },
    });
    for (const d of docs) {
      const content = typeof d.content === "string" ? d.content : JSON.stringify(d.content);
      const preview = content.slice(0, 800);
      console.log("\n===", proj.slug, d.title, "===");
      console.log(preview);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
