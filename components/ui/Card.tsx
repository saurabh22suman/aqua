import type { HTMLAttributes } from "react";
import { cn } from "./cn";

// UI foundation — Card / Section.
//
// The container for one block of content. One radius (the card radius),
// one border (the hairline), one padding scale — so a card on the
// Members screen and a card on the Fees screen are the same object.
//
// The parts are separate components so a caller can compose the
// header/body/footer it needs without the card inventing a layout.

export function Card({
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-card border border-line bg-paper", className)}
      {...rest}
    />
  );
}

export function CardHeader({
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-wrap items-start gap-2 px-5 py-4", className)}
      {...rest}
    />
  );
}

export function CardTitle({
  className,
  ...rest
}: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        "font-display text-[15px] font-semibold text-ink",
        className,
      )}
      {...rest}
    />
  );
}

export function CardDescription({
  className,
  ...rest
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn("mt-0.5 text-[13px] text-ink-3", className)} {...rest} />
  );
}

export function CardContent({
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 pb-5", className)} {...rest} />;
}

export function CardFooter({
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 border-t border-line px-5 py-3",
        className,
      )}
      {...rest}
    />
  );
}
