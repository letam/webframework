import React, { ReactElement } from "react";
import { IPost } from "types";

interface Properties {
  post: IPost;
}
export default function Post({ post }: Properties): ReactElement {
  return (
    <div data-cy="PostCard" tabIndex={0}>
      <h3 data-cy="PostCardHeadline" className="p-6 font-bold text-xl">
        {post.created} - {post.head}
      </h3>
    </div>
  );
}
