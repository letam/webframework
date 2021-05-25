import React, { ReactElement, useState, useCallback } from "react";
import { store } from "store";

interface ICSRFToken {
  token: string;
}

type ILogin = string;

async function login(
  eventTarget: HTMLFormElement,
  username: string,
  password: string
) {
  const data = (await (await fetch("/auth/csrf/")).json()) as ICSRFToken;
  const csrftoken = data.token;
  return (
    await fetch("/auth/login/", {
      method: eventTarget.method,
      headers: { "X-CSRFToken": csrftoken },
      body: JSON.stringify({ username, password }),
    })
  ).json() as Promise<ILogin>;
}

export default function Login(): ReactElement {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      // TODO: Form validation
      const userId = await login(
        event.target as HTMLFormElement,
        username,
        password
      );
      store.set("userId", userId);
    },
    [username, password]
  );
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
          Sign in to your account
        </h2>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          <form className="space-y-6" onSubmit={handleSubmit} method="POST">
            <div>
              {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
              <label
                htmlFor="username"
                className="block text-sm font-medium text-gray-700"
              >
                Username
              </label>
              <div className="mt-1">
                <input
                  id="username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  required
                  className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  onChange={(event) => setUsername(event.target.value)}
                  value={username}
                />
              </div>
            </div>

            <div>
              {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
              <label
                htmlFor="password"
                className="block text-sm font-medium text-gray-700"
              >
                Password
              </label>
              <div className="mt-1">
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  onChange={(event) => setPassword(event.target.value)}
                  value={password}
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <input
                  id="remember_me"
                  name="remember_me"
                  type="checkbox"
                  className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                />
                {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
                <label
                  htmlFor="remember_me"
                  className="ml-2 block text-sm text-gray-900"
                >
                  Remember me
                </label>
              </div>

              <div className="text-sm">
                <a
                  href="#"
                  className="font-medium text-indigo-600 hover:text-indigo-500"
                >
                  Forgot your password?
                </a>
              </div>
            </div>

            <div>
              <button
                type="submit"
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                Sign in
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
