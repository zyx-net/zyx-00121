import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "@/components/Layout";
import Dashboard from "@/pages/Dashboard";
import Rules from "@/pages/Rules";
import Import from "@/pages/Import";
import Review from "@/pages/Review";
import History from "@/pages/History";
import Report from "@/pages/Report";

export default function App() {
  return (
    <Router>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/rules" element={<Rules />} />
          <Route path="/import" element={<Import />} />
          <Route path="/review/:batchId" element={<Review />} />
          <Route path="/history" element={<History />} />
          <Route path="/report/:batchId" element={<Report />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Router>
  );
}
