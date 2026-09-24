import { useSearchParams } from "react-router-dom";
import { Button } from "../components/ui";
import SubcontractWorkMaster from "./SubcontractWorkMaster";
import SubcontractorMaster from "./SubcontractorMaster";

export default function SubcontractMasters() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = searchParams.get("tab");
  const activeTab = urlTab === "subcontractor" ? "subcontractor" : "work";

  const handleTabChange = (tab) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (tab === "subcontractor") {
        next.set("tab", "subcontractor");
      } else {
        next.delete("tab");
      }
      return next;
    });
  };

  return (
    <div>
      <div className="px-4 pt-4 sm:px-6 sm:pt-6">
        <div className="flex gap-2">
          <Button size="sm" variant={activeTab === "work" ? "primary" : "glass"} onClick={() => handleTabChange("work")}>
            Subcontract Work Master
          </Button>
          <Button size="sm" variant={activeTab === "subcontractor" ? "primary" : "glass"} onClick={() => handleTabChange("subcontractor")}>
            Subcontractor Master
          </Button>
        </div>
      </div>
      {activeTab === "work" ? <SubcontractWorkMaster /> : <SubcontractorMaster />}
    </div>
  );
}
