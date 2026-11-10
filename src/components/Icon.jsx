import React from "react";

const paths = {
  workspace: ["M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"],
  calendar: [
    "M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1ZM8 3v4M16 3v4M4 10h16M8 14h2M14 14h2M8 17h2",
  ],
  users: [
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  ],
  "credit-card": [
    "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1ZM3 10h18M7 15h4",
  ],
  chart: ["M4 3v17h17M8 16v-5M13 16V7M18 16v-8"],
  inventory: ["m12 3 9 5v9l-9 5-9-5V8l9-5ZM3 8l9 5 9-5M12 13v9M8 5l9 5"],
  staff: ["M8 6V4h8v2M4 7h16v13H4zM4 12l8 3 8-3M10 12h4v4h-4z"],
  payroll: ["M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7"],
  settings: [
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM10 3h4l.8 2.8 2.5 1.4 2.8-.7 2 3.4-2 2v2.2l2 2-2 3.4-2.8-.7-2.5 1.4L14 23h-4l-.8-2.8-2.5-1.4-2.8.7-2-3.4 2-2v-2.2l-2-2 2-3.4 2.8.7 2.5-1.4L10 3Z",
  ],
  plus: ["M12 5v14M5 12h14"],
  "chevron-left": ["m14 6-6 6 6 6"],
  "chevron-right": ["m10 6 6 6-6 6"],
  "arrow-right": ["M4 12h16m-6-6 6 6-6 6"],
  menu: ["M4 6h16M4 12h16M4 18h16"],
  close: ["m6 6 12 12M6 18 18 6"],
  refresh: [
    "M20 7a8 8 0 0 0-14-2L3 8m0-5v5h5M4 17a8 8 0 0 0 14 2l3-3m0 5v-5h-5",
  ],
  search: ["M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5 12 5 5"],
  store: [
    "M3 10 5 4h14l2 6M3 10v2a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0v-2H3ZM5 15v6h14v-6M10 21v-5h4v5",
  ],
  lock: ["M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5zM12 14v3"],
  check: ["m5 12 4 4L19 6"],
  download: ["M12 3v12m-5-5 5 5 5-5M4 15v6h16v-6"],
  clock: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7v5l3 2"],
  bell: [
    "M6 16V11a6 6 0 1 1 12 0v5l2 2H4l2-2ZM10 20a2 2 0 0 0 4 0",
  ],
  wallet: [
    "M4 6h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4zM4 6l11-3v3M16 13h4",
  ],
};

export function Icon({ name, size = 18, className = "", ...props }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`icon ${className}`}
      {...props}
    >
      {(paths[name] || paths.workspace).map((path, index) => (
        <path key={index} d={path} />
      ))}
    </svg>
  );
}
export default Icon;
