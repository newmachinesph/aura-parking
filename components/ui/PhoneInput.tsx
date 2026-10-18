"use client";

import { PhoneInput as ReactPhoneInput } from "react-international-phone";
import "react-international-phone/style.css";

interface PhoneInputProps {
  label?: string;
  value: string;
  onChange: (phone: string) => void;
  error?: string;
}

export default function PhoneInput({ label, value, onChange, error }: PhoneInputProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label className="text-sm font-medium text-text-primary">{label}</label>
      )}
      <ReactPhoneInput
        defaultCountry="us"
        value={value}
        onChange={onChange}
        inputClassName="phone-input-field"
        countrySelectorStyleProps={{
          buttonClassName: "phone-country-btn",
        }}
      />
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
