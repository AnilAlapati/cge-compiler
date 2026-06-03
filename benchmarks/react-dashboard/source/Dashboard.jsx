import React, { useState, useEffect } from 'react';
import { fetchDashboardStats } from './api';
import { StatCard } from './components/StatCard';
import { UserTable } from './components/UserTable';

export function Dashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function loadData() {
      try {
        const data = await fetchDashboardStats();
        setStats(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  if (loading) return <div>Loading dashboard...</div>;
  if (error) return <div className="error">Error: {error}</div>;

  return (
    <div className="dashboard-container">
      <h1>Admin Dashboard</h1>
      <div className="stats-grid">
        <StatCard title="Total Users" value={stats.totalUsers} trend={stats.userTrend} />
        <StatCard title="Revenue" value={`$${stats.revenue}`} trend={stats.revenueTrend} />
      </div>
      <div className="recent-activity">
        <h2>Recent Users</h2>
        <UserTable users={stats.recentUsers} onEdit={(id) => console.log('Edit', id)} />
      </div>
    </div>
  );
}
