export { BlogMediaBackup } from "../../../apps/web/worker/blog.ts";
export default {
  fetch() { return new Response("Not found", { status: 404 }); },
};
