import { store } from "store";
import { BACKEND_HOST } from "./constants";

interface ICSRFToken {
  token: string;
}

let csrftoken = store.get("csrftoken") as string;

async function getCsrfToken(): Promise<string> {
  if (csrftoken) {
    return csrftoken;
  }
  const data = (await (
    await fetch(`${BACKEND_HOST}/auth/csrf/`)
  ).json()) as ICSRFToken;
  store.set("csrftoken", data.token);
  csrftoken = data.token;
  return csrftoken;
}

export { getCsrfToken };
