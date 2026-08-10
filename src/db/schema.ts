import { int, sqliteTable } from "drizzle-orm/sqlite-core";

export const helloTable = sqliteTable("hellos_table", {
  id: int().primaryKey({ autoIncrement: true })
});
