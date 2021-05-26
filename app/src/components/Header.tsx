import React, { ReactElement, useEffect } from "react";
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
      <div>
        <h1 style={{ margin: "16px" }}>Wut?</h1>
        <hr />
      </div>
    </>
  );
}
