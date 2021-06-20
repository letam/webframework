import React, { ReactElement } from "react";
import { Link } from "react-router-dom";

import Logout from "components/Logout";
import { useAuthContext } from "contexts/auth";

export default function Header(): ReactElement {
  const auth = useAuthContext();

  return (
    <>
      <div className=" flex flex-row items-center justify-between">
        <Link className="m-4" to="/">
          <h1>Wut?</h1>
        </Link>
        {!auth.isInitialized ? undefined : auth.isAuthenticated ? (
          <div className="m-4">
            <div
              style={{
                display: "inline-block",
                marginRight: "1em",
              }}
            >
              Hello <span style={{ fontWeight: "bold" }}>{auth.username}</span>!
            </div>
            <Logout />
          </div>
        ) : (
          <Link className="m-4" to="/login">
            Login
          </Link>
        )}
      </div>
      <hr />
    </>
  );
}
