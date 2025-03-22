import type { IDetailResponse, IPost } from "../types";
import { BACKEND_HOST } from "./constants";
import { csrfToken } from "./csrf";

export default async function createPost(data: FormData, files: {audio?: File}): Promise<IPost> {

  let response;

  // Check environment variable to see if we upload to S3 cloud-compatible storage or local storage
  const uploadToS3 = import.meta.env.VITE_UPLOAD_FILES_TO_S3 === "true";
  const hasFile = !!files.audio;
  const file = files.audio!;
  if (hasFile && uploadToS3) {

    // Get presigned url from backend
    response = await fetch(`${BACKEND_HOST}/api/uploads/presign/`, {
      method: "POST",
      headers: {
        "X-CSRFToken": csrfToken.token,
      },
      body: JSON.stringify({
        file_name: file.name,
        content_type: file.type,
      }),
    });
    // get presigned url from response
    const presignedUrl = (await response.json()) as { url: string, file_path: string };

    // upload file to s3
    // NOTE: Must edit CORS settings for the bucket, refer to project's server/config/s3-cors.json
    // https://dash.cloudflare.com/<ACCOUNT_ID>/r2/default/buckets/<bucket_name>/cors/edit
    await fetch(presignedUrl.url, {
      method: "PUT",
      headers: {
        'Content-Type': file.type,
      },
      body: file,
    });

    // create post with file url
    data.set("audio_s3_file_key", presignedUrl.file_path);
    response = await fetch(`${BACKEND_HOST}/api/posts/`, {
      method: "POST",
      headers: {
        "X-CSRFToken": csrfToken.token,
      },
      body: data,
    });
  } else {
    if (hasFile) {
      if (files.audio) {
        data.append('audio', files.audio);
      }
    }
    response = await fetch(`${BACKEND_HOST}/api/posts/`, {
      method: "POST",
      headers: {
        "X-CSRFToken": csrfToken.token,
      },
      body: data,
    });
  }

  if (response.status !== 201) {
    const responseBody = (await response.json()) as IDetailResponse;
    throw new Error(responseBody.detail);
  }
  return response.json() as Promise<IPost>;
}
