import {z} from "zod";
export const GlobalAccessSchema=z.discriminatedUnion("kind",[
  z.object({kind:z.literal("job"),id:z.string().min(1).max(200),token:z.string().min(16).max(512)}).strict(),
  z.object({kind:z.literal("history"),id:z.string().min(1).max(200),token:z.string().min(16).max(512)}).strict(),
  z.object({kind:z.literal("share"),token:z.string().min(24).max(256)}).strict(),
]);
export type GlobalAccess=z.infer<typeof GlobalAccessSchema>;
