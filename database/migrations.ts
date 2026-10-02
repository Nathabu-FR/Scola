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
  ],
});
