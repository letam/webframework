import { BACKEND_HOST } from "api/constants";
import { csrfToken } from "api/csrf";

import { IFormResponse } from "types";

type ILogin = string;

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
  return (
    await fetch(`${BACKEND_HOST}/auth/logout/`, {
      method: "POST",
      headers: { "X-CSRFToken": csrfToken.token },
    })
  ).json() as Promise<void>;
}

// eslint-disable-next-line import/prefer-default-export
export { login, logout };
