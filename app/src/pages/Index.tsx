import type { ReactElement } from "react";

import PostList from "../components/PostList";
import PostForm from "../components/PostForm";
import Header from "../components/Header";
import Head from "../components/Head";

export default function Index(): ReactElement {
  return (
    <>
      <Head title="wut up" />
      <Header />
      <div className="w-full">
        <PostForm />
      </div>
      <PostList />
    </>
  );
}
