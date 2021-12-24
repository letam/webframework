import React, { lazy, ReactElement, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import { AuthContextProvider } from "contexts/auth";
import LoadingOrError from "./LoadingOrError";
import PageNotFound from "./PageNotFound";

const Index = lazy(() => import("./Index"));
const Login = lazy(() => import("./Login"));
const FruitDetails = lazy(() => import("./FruitDetails"));
const FruitGallery = lazy(() => import("./FruitGallery"));

const routes = [
  {
    path: "/",
    component: Index,
    exact: true,
  },
  {
    path: "*",
    component: PageNotFound,
  },
  {
    path: "/login",
    component: Login,
    exact: true,
  },
  {
    path: "/fruits",
    component: FruitGallery,
    exact: true,
  },
  {
    path: "/:fruitName",
    component: FruitDetails,
  },
];

export default function App(): ReactElement {
  return (
    <AuthContextProvider>
      <BrowserRouter>
        <Suspense fallback={<LoadingOrError />}>
          <Routes>
            {routes.map(({ path, component: Component, exact }) => (
              <Route key={path} {...{ path, exact }} element={<Component />} />
            ))}
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthContextProvider>
  );
}
