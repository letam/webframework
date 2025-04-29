import type { ReactElement } from "react";
import { Link } from "react-router";

import Logout from "../components/Logout";
import { useAuthContext } from "../contexts/auth";
import { ThemeToggle } from "../components/ThemeToggle";

export default function Header(): ReactElement {
  const auth = useAuthContext();

  return (
    <>
      <div className="flex flex-row items-center justify-between">
        <Link
          className="m-4 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:rounded-md p-2"
          to="/"
          tabIndex={0}
        >
          <h1>Wut?</h1>
        </Link>
        <div className="flex flex-row items-center justify-between">
          {!auth.isInitialized ? undefined : auth.isAuthenticated ? (
            <div className="m-4">
              <div
                style={{
                  display: "inline-block",
                  marginRight: "1em",
                }}
              >
                Hello{" "}
                <span style={{ fontWeight: "bold" }}>{auth.user.username}</span>!
              </div>
              <Logout />
            </div>
          ) : (
            <Link
              className="m-4 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:rounded-md p-2"
              to="/login"
              tabIndex={0}
            >
              Login
            </Link>
          )}
          <div className="m-4">
            <ThemeToggle />
          </div>
        </div>
      </div>
      <hr />
    </>
  );
}
