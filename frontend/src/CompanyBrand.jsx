import logo from "./assets/pocket-company-logo.png";

// Preserve the supplied CI artwork; only its surrounding whitespace is clipped.
export default function CompanyBrand() {
  return <span className="topbar-company-brand"><img src={logo} alt="POCKET COMPANY" width="808" height="243" draggable="false" /></span>;
}
