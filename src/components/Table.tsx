import React from 'react'

export interface TableColumn<T = any> {
  key: string
  header: string
  align?: 'left' | 'center' | 'right'
  render?: (item: T, index: number) => React.ReactNode
  className?: string
  headerClassName?: string
  /** Hide this field from the mobile card layout */
  hideOnMobile?: boolean
  /** Use as the card title on mobile (defaults to first column) */
  mobilePrimary?: boolean
}

export interface TableProps<T = any> {
  columns: TableColumn<T>[]
  data: T[]
  emptyMessage?: string
  emptyIcon?: React.ReactNode
  rowKey?: (item: T, index: number) => string | number
  rowClassName?: (item: T, index: number) => string
  onRowClick?: (item: T, index: number) => void
  className?: string
  headerClassName?: string
  bodyClassName?: string
}

export function Table<T = any>({
  columns,
  data,
  emptyMessage = 'No data available',
  emptyIcon,
  rowKey = (_, index) => index,
  rowClassName,
  onRowClick,
  className = '',
  headerClassName = 'bg-slate-50 border-b border-slate-200',
  bodyClassName = 'divide-y divide-slate-200'
}: TableProps<T>) {
  const getAlignClass = (align?: 'left' | 'center' | 'right') => {
    switch (align) {
      case 'center':
        return 'text-center'
      case 'right':
        return 'text-right'
      default:
        return 'text-left'
    }
  }

  const primaryCol =
    columns.find((c) => c.mobilePrimary) || columns.find((c) => !c.hideOnMobile) || columns[0]
  const detailCols = columns.filter(
    (c) => c.key !== primaryCol?.key && !c.hideOnMobile
  )

  if (data.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-6 py-12 text-center text-slate-500">
          {emptyIcon && <div className="mb-4">{emptyIcon}</div>}
          <p>{emptyMessage}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
      {/* Mobile cards */}
      <div className="md:hidden divide-y divide-slate-200">
        {data.map((item, index) => {
          const key = rowKey(item, index)
          const rowClass = rowClassName ? rowClassName(item, index) : ''
          const primaryContent = primaryCol?.render
            ? primaryCol.render(item, index)
            : (item as any)[primaryCol?.key]

          return (
            <div
              key={key}
              className={`p-4 ${onRowClick ? 'cursor-pointer active:bg-slate-50' : ''} ${rowClass}`}
              onClick={() => onRowClick?.(item, index)}
            >
              <div className="mb-3">{primaryContent}</div>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
                {detailCols.map((column) => {
                  const cellContent = column.render
                    ? column.render(item, index)
                    : (item as any)[column.key]
                  return (
                    <div key={column.key} className="min-w-0">
                      <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                        {column.header}
                      </dt>
                      <dd className="mt-0.5 text-sm text-slate-800 break-words">{cellContent}</dd>
                    </div>
                  )
                })}
              </dl>
            </div>
          )
        })}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto">
        <table className={`w-full ${className}`}>
          <thead className={headerClassName}>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={`px-6 py-3 ${getAlignClass(column.align)} text-xs font-semibold text-slate-700 uppercase tracking-wider ${column.headerClassName || ''}`}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className={bodyClassName}>
            {data.map((item, index) => {
              const key = rowKey(item, index)
              const rowClass = rowClassName ? rowClassName(item, index) : ''
              const baseRowClass = onRowClick
                ? 'cursor-pointer hover:bg-slate-50 transition-colors'
                : 'hover:bg-slate-50 transition-colors'

              return (
                <tr
                  key={key}
                  className={`${baseRowClass} ${rowClass}`}
                  onClick={() => onRowClick?.(item, index)}
                >
                  {columns.map((column) => {
                    const cellContent = column.render
                      ? column.render(item, index)
                      : (item as any)[column.key]

                    return (
                      <td
                        key={column.key}
                        className={`px-6 py-4 ${getAlignClass(column.align)} ${column.className || ''}`}
                      >
                        {cellContent}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
