import React, { ReactElement, useEffect } from "react";
import { Link } from "react-router-dom";

import { store } from "store";

export default function Header(): ReactElement {
  useEffect(() => {
    const username = store.get("username") as string;
    if (username) {
      console.log("auth as:", username);
    }
  }, []);

  return (
    <>
      <div className=" flex flex-row items-center justify-between">
        <Link className="m-4" to="/">
          <h1>Wut?</h1>
        </Link>
        <Link className="m-4" to="/login">
          Login
        </Link>
      </div>
      <hr />
    </>
  );
}
