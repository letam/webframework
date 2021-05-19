import PostList from "components/PostList";
import PostForm from "components/PostForm";
import Head from "components/Head";
import React, { ReactElement } from "react";

export default function Index(): ReactElement {
  return (
    <>
      <Head title="wut up" />
      <PostForm />
      <PostList />
    </>
  );
}
