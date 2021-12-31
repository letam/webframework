import { BACKEND_HOST } from "api/constants";
import { csrfToken } from "api/csrf";

import type { IFormResponse } from "types";

type ILogin = string;
type IAuthStatus = {
  is_authenticated: boolean;
};

async function login(username: string, password: string): Promise<ILogin> {
  const response = await fetch(`${BACKEND_HOST}/auth/login/`, {
    method: "POST",
    headers: { "X-CSRFToken": csrfToken.token },
    body: JSON.stringify({ username, password }),
  });
  if (response.status !== 200) {
    const responseBody = (await response.json()) as IFormResponse;
    throw new Error(responseBody.form[0]);
  }
  return response.json() as Promise<ILogin>;
}

async function logout(): Promise<void> {
  const response = await fetch(`${BACKEND_HOST}/auth/logout/`, {
    method: "POST",
    headers: { "X-CSRFToken": csrfToken.token },
  });
  return response.json() as Promise<void>;
}

async function fetchAuthStatus(): Promise<IAuthStatus> {
  const response = await fetch(`${BACKEND_HOST}/auth/status/`, {
    method: "GET",
  });
  return response.json() as Promise<IAuthStatus>;
}

// Set global window variables for easy debugging
(window as any).fetchAuthStatus = fetchAuthStatus; // eslint-disable-line @typescript-eslint/no-explicit-any,@typescript-eslint/no-unsafe-member-access,no-underscore-dangle

// eslint-disable-next-line import/prefer-default-export
export { login, logout, fetchAuthStatus };
