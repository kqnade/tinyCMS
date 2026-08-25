import {
  type AriaAttributes,
  type ButtonHTMLAttributes,
  Children,
  cloneElement,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  useId,
} from "react";

type ButtonVariant = "primary" | "secondary" | "ghost";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  variant?: ButtonVariant;
};

export function Button({
  className,
  disabled,
  loading = false,
  type = "button",
  variant = "secondary",
  ...props
}: ButtonProps) {
  const classes = ["ui-button", `ui-button--${variant}`, className].filter(Boolean).join(" ");

  return (
    <button
      {...props}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading ? "true" : undefined}
      className={classes}
    />
  );
}

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, ...props }: InputProps) {
  const classes = ["ui-input", className].filter(Boolean).join(" ");

  return <input {...props} className={classes} />;
}

type FieldControlProps = {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: AriaAttributes["aria-invalid"];
};

export type FieldProps = {
  children: ReactElement<FieldControlProps>;
  className?: string;
  error?: ReactNode;
  helpText?: ReactNode;
  id?: string;
  label: ReactNode;
};

export function Field({ children, className, error, helpText, id, label }: FieldProps) {
  const generatedId = useId().replaceAll(":", "");
  const child = Children.only(children);
  const inputId = id ?? child.props.id ?? `field-${generatedId}`;
  const helpId = helpText ? `${inputId}-help` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [child.props["aria-describedby"], helpId, errorId].filter(Boolean).join(" ");
  const input = cloneElement(child, {
    id: inputId,
    ...(describedBy ? { "aria-describedby": describedBy } : {}),
    ...(error ? { "aria-invalid": true } : {}),
  });
  const classes = ["ui-field", className].filter(Boolean).join(" ");

  return (
    <div className={classes}>
      <label className="ui-field__label" htmlFor={inputId}>
        {label}
      </label>
      {input}
      {helpText ? (
        <p className="ui-field__help" id={helpId}>
          {helpText}
        </p>
      ) : null}
      {error ? (
        <p className="ui-field__error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type CardElement = "article" | "aside" | "div" | "section";
type CardVariant = "default" | "subtle";

export type CardProps = HTMLAttributes<HTMLElement> & {
  as?: CardElement;
  variant?: CardVariant;
};

export function Card({ as = "div", className, variant = "default", ...props }: CardProps) {
  const Element = as;
  const classes = ["ui-card", `ui-card--${variant}`, className].filter(Boolean).join(" ");

  return <Element {...props} className={classes} />;
}

type BadgeTone = "danger" | "info" | "neutral" | "success" | "warning";

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
};

export function Badge({ className, tone = "neutral", ...props }: BadgeProps) {
  const classes = ["ui-badge", `ui-badge--${tone}`, className].filter(Boolean).join(" ");

  return <span {...props} className={classes} />;
}
