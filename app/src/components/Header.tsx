import React, { ReactElement, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { store } from "store";

export default function Header(): ReactElement {
  const [authStatus, setAuthStatus] = useState({
    isInitialized: false,
    isAuthenticated: false,
    username: "",
  });
  useEffect(() => {
    const username = store.get("username") as string;
    if (username) {
      console.log("auth as:", username);
      setAuthStatus((state) => ({
        ...state,
        isInitialized: true,
        isAuthenticated: true,
        username,
      }));
    }
  }, []);

  return (
    <>
      <div className=" flex flex-row items-center justify-between">
        <Link className="m-4" to="/">
          <h1>Wut?</h1>
        </Link>
        {!authStatus.isInitialized ? undefined : authStatus.isAuthenticated ? (
          <button type="button" className="m-4">
            Logout
          </button>
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
