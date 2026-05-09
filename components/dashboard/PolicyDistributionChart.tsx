'use client'

import { PieChart, Pie, Cell, Legend, Tooltip, ResponsiveContainer } from 'recharts'

interface PolicyDistributionChartProps {
  data: {
    monthly: number
    annual: number
  }
}

export function PolicyDistributionChart({ data }: PolicyDistributionChartProps) {
  const total = data.monthly + data.annual
  const chartData = [
    {
      name: `Monthly (${data.monthly})`,
      value: data.monthly,
    },
    {
      name: `Annual (${data.annual})`,
      value: data.annual,
    },
  ]

  const COLORS = ['#2563eb', '#1e40af']

  const renderLabel = (entry: any) => {
    if (total === 0) return '0%'
    const percentage = ((entry.value / total) * 100).toFixed(1)
    return `${percentage}%`
  }

  return (
    <div className="w-full h-64 flex flex-col gap-4">
      <ResponsiveContainer width="100%" height={250}>
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            labelLine={false}
            label={renderLabel}
            outerRadius={80}
            fill="#8884d8"
            dataKey="value"
          >
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value: any) => [`${value} policies`, 'Count']}
            contentStyle={{ backgroundColor: '#f3f4f6', border: 'none', borderRadius: '8px' }}
          />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
      <div className="grid grid-cols-2 gap-4 mt-4">
        <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
          <div className="text-xs text-blue-600 font-medium">Monthly Policies</div>
          <div className="text-2xl font-bold text-blue-900">{data.monthly}</div>
        </div>
        <div className="p-3 bg-blue-100 rounded-lg border border-blue-300">
          <div className="text-xs text-blue-700 font-medium">Annual Policies</div>
          <div className="text-2xl font-bold text-blue-900">{data.annual}</div>
        </div>
      </div>
      <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
        <div className="text-sm text-gray-600">
          <span className="font-semibold">Total Active Policies:</span> {total}
        </div>
      </div>
    </div>
  )
}
