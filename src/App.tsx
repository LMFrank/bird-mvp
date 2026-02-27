import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Home from "@/pages/Home";
import { useEffect } from "react";
import { useCatalogStore } from "@/store/catalogStore";

export default function App() {
  useEffect(() => {
    useCatalogStore.getState().loadTaxonomy()
  }, [])

  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/other" element={<div className="text-center text-xl">Other Page - Coming Soon</div>} />
      </Routes>
    </Router>
  );
}
