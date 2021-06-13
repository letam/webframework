import { BACKEND_HOST } from "./constants";

interface ICSRFToken {
  token: string;
}

async function fetchCsrfToken(): Promise<string> {
  const data = (await (
    await fetch(`${BACKEND_HOST}/auth/csrf/`)
  ).json()) as ICSRFToken;
  return data.token;
}

class CSRFToken {
  token: string;

  constructor() {
    this.token = "";
  }

  async fetchCsrfToken(): Promise<string> {
    this.token = await fetchCsrfToken();
    return this.token;
  }
}

const csrfToken = new CSRFToken();
csrfToken.fetchCsrfToken(); // eslint-disable-line @typescript-eslint/no-floating-promises

export { csrfToken }; // eslint-disable-line import/prefer-default-export
