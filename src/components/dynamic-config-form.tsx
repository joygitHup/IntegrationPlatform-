/**
 * 动态表单渲染器
 * 根据连接器 configSchema 自动生成表单
 * 支持：分组、条件显示、密码、选择器、数字、文本、文本域、布尔开关
 */

'use client';

import { useState, useEffect } from 'react';

export interface ConfigField {
  name: string;
  label: string;
  type: 'string' | 'password' | 'number' | 'boolean' | 'select' | 'textarea' | 'port';
  required?: boolean;
  defaultValue?: any;
  placeholder?: string;
  help?: string;
  group?: string;
  options?: { value: string; label: string }[];
  sensitive?: boolean;
  showWhen?: { field: string; value: string };
}

export interface ConfigSchema {
  required?: string[];
  fields: ConfigField[];
}

interface DynamicFormProps {
  schema: ConfigSchema;
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  errors?: Record<string, string>;
  disabled?: boolean;
}

export function DynamicConfigForm({ schema, values, onChange, errors = {}, disabled = false }: DynamicFormProps) {
  // 按 group 分组
  const groups: Record<string, ConfigField[]> = {};
  const ungrouped: ConfigField[] = [];
  for (const field of schema.fields) {
    if (field.group) {
      if (!groups[field.group]) groups[field.group] = [];
      groups[field.group].push(field);
    } else {
      ungrouped.push(field);
    }
  }

  // 判断字段是否显示
  const shouldShow = (field: ConfigField): boolean => {
    if (!field.showWhen) return true;
    const depValue = values[field.showWhen.field];
    return String(depValue) === field.showWhen.value;
  };

  const handleChange = (name: string, value: unknown) => {
    onChange({ ...values, [name]: value });
  };

  const renderField = (field: ConfigField) => {
    if (!shouldShow(field)) return null;
    const value = values[field.name] ?? field.defaultValue ?? '';
    const hasError = !!errors[field.name];
    const baseInputClass = `w-full px-3 py-2 text-sm border rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${hasError ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-white'} ${disabled ? 'bg-gray-50 text-gray-500 cursor-not-allowed' : ''}`;

    return (
      <div key={field.name} className="space-y-1.5">
        <label className="flex items-center text-sm font-medium text-gray-700">
          {field.label}
          {field.required && <span className="ml-0.5 text-red-500">*</span>}
        </label>

        {field.type === 'string' && (
          <input
            type="text"
            value={String(value)}
            onChange={(e) => handleChange(field.name, e.target.value)}
            placeholder={field.placeholder}
            disabled={disabled}
            className={baseInputClass}
          />
        )}

        {field.type === 'password' && (
          <PasswordInput
            value={String(value)}
            onChange={(v) => handleChange(field.name, v)}
            placeholder={field.placeholder}
            disabled={disabled}
            className={baseInputClass}
          />
        )}

        {field.type === 'number' && (
          <input
            type="number"
            value={value as number}
            onChange={(e) => handleChange(field.name, Number(e.target.value))}
            placeholder={field.placeholder}
            disabled={disabled}
            className={baseInputClass}
          />
        )}

        {field.type === 'port' && (
          <input
            type="number"
            value={value as number}
            onChange={(e) => handleChange(field.name, Number(e.target.value))}
            disabled={disabled}
            min={1}
            max={65535}
            className={baseInputClass}
          />
        )}

        {field.type === 'select' && (
          <select
            value={String(value)}
            onChange={(e) => handleChange(field.name, e.target.value)}
            disabled={disabled}
            className={baseInputClass}
          >
            {field.options?.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        )}

        {field.type === 'boolean' && (
          <label className="flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(value)}
              onChange={(e) => handleChange(field.name, e.target.checked)}
              disabled={disabled}
              className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
            />
            <span className="ml-2 text-sm text-gray-600">启用</span>
          </label>
        )}

        {field.type === 'textarea' && (
          <textarea
            value={String(value)}
            onChange={(e) => handleChange(field.name, e.target.value)}
            placeholder={field.placeholder}
            disabled={disabled}
            rows={4}
            className={`${baseInputClass} resize-y font-mono`}
          />
        )}

        {field.help && (
          <p className="text-xs text-gray-500">{field.help}</p>
        )}

        {hasError && (
          <p className="text-xs text-red-500">{errors[field.name]}</p>
        )}
      </div>
    );
  };

  const groupNames = Object.keys(groups);

  return (
    <div className="space-y-6">
      {ungrouped.length > 0 && (
        <div className="grid grid-cols-2 gap-4">
          {ungrouped.map(renderField)}
        </div>
      )}
      {groupNames.map((groupName) => {
        const groupFields = groups[groupName].filter(shouldShow);
        if (groupFields.length === 0) return null;
        return (
          <div key={groupName}>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1 h-4 bg-blue-500 rounded-full" />
              <h4 className="text-sm font-semibold text-gray-700">{groupName}</h4>
            </div>
            <div className="grid grid-cols-2 gap-4 pl-3 border-l border-gray-100">
              {groups[groupName].map(renderField)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** 密码输入框（支持显隐切换） */
function PasswordInput({
  value,
  onChange,
  placeholder,
  disabled,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className: string;
}) {
  const [show, setShow] = useState(false);

  // 敏感字段占位符：如果值存在且是密文形式，用占位显示，用户输入时才替换
  const isMasked = value && value.length > 20 && value.includes('**');
  const [localValue, setLocalValue] = useState('');
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setLocalValue('');
  }, [editing]);

  if (isMasked && !editing) {
    return (
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          disabled
          className={`${className} flex-1 opacity-60`}
        />
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="px-3 py-2 text-sm text-blue-600 border border-blue-200 rounded-md hover:bg-blue-50"
        >
          重新设置
        </button>
      </div>
    );
  }

  const displayValue = editing ? localValue : value;

  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        value={displayValue}
        onChange={(e) => {
          if (editing) {
            setLocalValue(e.target.value);
            onChange(e.target.value);
          } else {
            setEditing(true);
            setLocalValue(e.target.value);
            onChange(e.target.value);
          }
        }}
        placeholder={placeholder}
        disabled={disabled}
        className={`${className} pr-10`}
      />
      <button
        type="button"
        onClick={() => setShow(!show)}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
      >
        {show ? (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        )}
      </button>
    </div>
  );
}
