export interface IFruit {
  name: string;
  image: {
    author: {
      name: string;
      url: string;
    };
    color: string;
    url: string;
  };
  metadata: [
    {
      name: string;
      value: string;
    }
  ];
}

export interface IFormResponse {
  form: [string];
}

export interface IDetailResponse {
  detail: string;
}

export interface IAuthor {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
}

export interface IPost {
  url: string;
  created: string;
  author: IAuthor;
  head: string;
  body: string;
  audio?: string;
}
