import type { ReactNode } from "react";
import { Search, ChevronLeft, ChevronRight } from "lucide-react";
import { Input } from "./ui/input.js";
import { Button } from "./ui/button.js";
export function ListToolbar({
  searchLabel,
  placeholder,
  query,
  onQueryChange,
  children,
}: {
  searchLabel: string;
  placeholder: string;
  query: string;
  onQueryChange: (query: string) => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col lg:flex-row gap-3 mb-5">
      <div className="relative flex-1 min-w-0">
        <Search
          size={16}
          className="absolute top-2.5 left-3 text-muted-foreground"
        />
        <Input
          aria-label={searchLabel}
          className="pl-9"
          placeholder={placeholder}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
      </div>
      {children && (
        <div className="flex flex-wrap sm:flex-nowrap gap-3 [&>select]:w-full lg:[&>select]:w-44">
          {children}
        </div>
      )}
    </div>
  );
}
export function ListPagination({
  page,
  total,
  pageSize = 20,
  noun,
  onPageChange,
}: {
  page: number;
  total: number;
  pageSize?: number;
  noun: string;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mt-4 text-xs text-muted-foreground">
      <p>
        {total
          ? `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, total)} of ${total} ${noun}`
          : `0 ${noun}`}
      </p>
      {total > pageSize && (
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Previous ${noun} page`}
            disabled={page === 0}
            onClick={() => onPageChange(page - 1)}
          >
            <ChevronLeft size={14} />
            Previous
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Next ${noun} page`}
            disabled={(page + 1) * pageSize >= total}
            onClick={() => onPageChange(page + 1)}
          >
            Next
            <ChevronRight size={14} />
          </Button>
        </div>
      )}
    </div>
  );
}
export function ListEmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action: ReactNode;
}) {
  return (
    <div className="rounded-xl border text-center py-14 px-6">
      <div className="mx-auto text-primary mb-4 w-fit">{icon}</div>
      <h2 className="text-lg font-medium">{title}</h2>
      <p className="text-sm text-muted-foreground mt-2 mb-5">{description}</p>
      {action}
    </div>
  );
}
export function ListNoResults({
  noun,
  onClear,
}: {
  noun: string;
  onClear: () => void;
}) {
  return (
    <div className="py-12 text-center border-b">
      <p className="font-medium text-sm">No matching {noun}</p>
      <p className="text-sm text-muted-foreground mt-2">
        Try another search or filter.
      </p>
      <Button variant="ghost" className="mt-3" onClick={onClear}>
        Clear filters
      </Button>
    </div>
  );
}
