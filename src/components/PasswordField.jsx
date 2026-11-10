import React, { useState } from "react";
import { Icon } from "./Icon";

export function PasswordField({ value, onChange, label, autoComplete, minLength, required = true, ...rest }) {
  const [show, setShow] = useState(false);
  return (
    <div className="password-input">
      <input
        {...rest}
        required={required}
        minLength={minLength}
        maxLength={128}
        type={show ? "text" : "password"}
        aria-label={label}
        autoComplete={autoComplete}
        value={value}
        onChange={onChange}
      />
      <button
        type="button"
        onClick={() => setShow(!show)}
        aria-label={show ? `${label} 숨기기` : `${label} 표시`}
      >
        <Icon name={show ? "eye-off" : "eye"} />
      </button>
    </div>
  );
}
export function PasswordRules({ value, confirm, min = 12 }) {
  const rules = [
    [`${min}자 이상`, value.length >= min],
    ["128자 이하", value.length > 0 && value.length <= 128],
    ["두 비밀번호가 같아요", value.length > 0 && value === confirm],
  ];
  return (
    <div className="password-rules" aria-label="비밀번호 규칙">
      <span className="field-label">비밀번호 규칙</span>
      <ul>
        {rules.map(([text, ok]) => (
          <li key={text} className={ok ? "is-ok" : ""}>
            <span className="password-rule-mark" aria-hidden="true">
              {ok && <Icon name="check" size={16} />}
            </span>
            {text}
            <span className="sr-only">{ok ? " 충족" : " 아직"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
