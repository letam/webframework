import { BACKEND_HOST } from "./constants";

interface ICSRFToken {
  token: string;
}

async function fetchCsrfToken(): Promise<string> {
  const response = await fetch(`${BACKEND_HOST}/auth/csrf/`);
  const data = (await response.json()) as ICSRFToken;
  return data.token;
}

class CSRFToken {
  public token: string;

  public constructor() {
    this.token = "";
  }

  public async fetchCsrfToken(): Promise<string> {
    this.token = await fetchCsrfToken();
    return this.token;
  }
}

const csrfToken = new CSRFToken();
csrfToken.fetchCsrfToken(); // eslint-disable-line @typescript-eslint/no-floating-promises

export { csrfToken }; // eslint-disable-line import/prefer-default-export
