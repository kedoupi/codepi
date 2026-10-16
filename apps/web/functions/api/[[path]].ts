import { handleDeskRequest, type DeskEnv } from "../../server/desk";

export const onRequest: PagesFunction<DeskEnv> = ({ request, env }) => handleDeskRequest(request, env);
