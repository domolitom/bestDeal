import { join } from "node:path";
import { FsReadAdapter } from "@bestdeal/shared";

const DATA_DIR = join(process.cwd(), "../../data/catalogs");

export const storage = new FsReadAdapter(DATA_DIR);
