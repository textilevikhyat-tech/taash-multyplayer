import { Routes, Route, Navigate } from "react-router-dom";
import Table from "./components/Table";

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/table" />} />
      <Route path="/table" element={<Table />} />
    </Routes>
  );
}

export default App;
