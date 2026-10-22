import { handle } from "@/server/http";
import { receivingTodo } from "@/server/modules/warehouse/service";

export const GET = handle(({ store }) => receivingTodo(store));
