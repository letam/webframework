import PostList from "components/PostList";
import Head from "components/Head";
import React, { ReactElement } from "react";

export default function Index(): ReactElement {
  return (
    <>
      <Head title="wut up" />
      <PostList />
    </>
  );
}
