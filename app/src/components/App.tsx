import React, { lazy, ReactElement, Suspense } from "react";
import { BrowserRouter, Route, Switch } from "react-router-dom";
import LoadingOrError from "./LoadingOrError";

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
    <BrowserRouter>
      <Suspense fallback={<LoadingOrError />}>
        <Switch>
          {routes.map(({ path, component, exact }) => (
            <Route key="path" {...{ path, component, exact }} />
          ))}
        </Switch>
      </Suspense>
    </BrowserRouter>
  );
}
