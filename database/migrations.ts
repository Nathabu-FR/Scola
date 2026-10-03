import { addColumns, schemaMigrations } from "@nozbe/watermelondb/Schema/migrations";

export default schemaMigrations({
  migrations: [
    {
      toVersion: 38,
      steps: [
        addColumns({
          table: "courses",
          columns: [{ name: "resourceId", type: "string", isOptional: true }],
        }),
      ],
    },
    {
      toVersion: 39,
      steps: [
        addColumns({
          table: "news",
          columns: [{ name: "survey", type: "string", isOptional: true }],
        }),
      ],
    },
  ],
});
