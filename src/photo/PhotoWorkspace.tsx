import BurstGroupList from "./BurstGroupList";
import PhotoToolbar from "./PhotoToolbar";
import SyncCompareView from "./SyncCompareView";
import "./PhotoWorkspace.css";

export default function PhotoWorkspace() {
  return (
    <div className="photo-workspace">
      <aside className="photo-sidebar">
        <BurstGroupList />
      </aside>
      <div className="photo-main">
        <PhotoToolbar />
        <div className="photo-compare-wrap">
          <SyncCompareView />
        </div>
      </div>
    </div>
  );
}
