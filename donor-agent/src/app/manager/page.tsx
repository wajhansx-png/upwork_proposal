import App from "../App";

/** The manager's page. Opened once with the private link (/manager?k=CODE); the phone remembers it. */
export default function ManagerPage() {
  return <App entry="manager" />;
}
