import React from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

type BreadcrumbItem = {
  label: string;
  to?: string;
};

interface BreadcrumbProps {
  items: BreadcrumbItem[];
  className?: string;
}

export const Breadcrumb: React.FC<BreadcrumbProps> = ({ items, className }) => {
  return (
    <nav aria-label="Breadcrumb" className={cn("flex items-center gap-1 text-sm", className)}>
      {items.map((item, index) => (
        <React.Fragment key={index}>
          {index > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
          {item.to ? (
            <Link to={item.to} className="font-semibold text-muted-foreground hover:text-foreground transition-colors">
              {item.label}
            </Link>
          ) : (
            <span className="font-bold text-foreground">{item.label}</span>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
};
