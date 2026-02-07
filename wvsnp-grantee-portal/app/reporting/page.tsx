'use client';

import { useState } from 'react';
import Link from 'next/link';

type ReportType = 'voucher_issuance' | 'service_completion' | 'quarterly_summary';

export default function ReportingPage() {
  const [reportType, setReportType] = useState<ReportType>('voucher_issuance');
  const [granteeCode, setGranteeCode] = useState('');
  const [authenticated, setAuthenticated] = useState(false);

  const handleLogin = () => {
    if (granteeCode) {
      setAuthenticated(true);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-100">
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <Link href="/" className="flex items-center text-blue-600 hover:text-blue-800">
              <svg className="h-6 w-6 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Back to Home
            </Link>
            {authenticated && (
              <button
                onClick={() => setAuthenticated(false)}
                className="text-sm text-gray-600 hover:text-gray-900"
              >
                Logout
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {!authenticated ? (
          <div className="bg-white rounded-lg shadow-md p-8 max-w-md mx-auto">
            <h1 className="text-3xl font-bold text-gray-900 mb-6">
              Grantee Reporting Portal
            </h1>
            <p className="text-gray-600 mb-6">
              Current WVSNP grantees: Enter your grantee code to access reporting tools.
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Grantee Code
                </label>
                <input
                  type="text"
                  value={granteeCode}
                  onChange={(e) => setGranteeCode(e.target.value.toUpperCase())}
                  placeholder="WVSNP-GRANTEE-XXXX"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                />
              </div>
              <button
                onClick={handleLogin}
                className="w-full px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                Access Reporting
              </button>
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mt-4">
                <p className="text-sm text-gray-600">
                  <strong>Note:</strong> For organizations using VetOS or ShelterOS, reporting is handled automatically through your platform. This portal is for non-platform participants only.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-md p-8">
              <h1 className="text-3xl font-bold text-gray-900 mb-2">
                Grantee Reporting
              </h1>
              <p className="text-gray-600 mb-6">
                Grantee Code: <span className="font-medium">{granteeCode}</span>
              </p>

              <div className="flex space-x-4 mb-6 border-b border-gray-200">
                <button
                  onClick={() => setReportType('voucher_issuance')}
                  className={`pb-3 px-4 font-medium transition-colors ${
                    reportType === 'voucher_issuance'
                      ? 'text-blue-600 border-b-2 border-blue-600'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Voucher Issuance
                </button>
                <button
                  onClick={() => setReportType('service_completion')}
                  className={`pb-3 px-4 font-medium transition-colors ${
                    reportType === 'service_completion'
                      ? 'text-blue-600 border-b-2 border-blue-600'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Service Completion
                </button>
                <button
                  onClick={() => setReportType('quarterly_summary')}
                  className={`pb-3 px-4 font-medium transition-colors ${
                    reportType === 'quarterly_summary'
                      ? 'text-blue-600 border-b-2 border-blue-600'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Quarterly Summary
                </button>
              </div>

              {reportType === 'voucher_issuance' && (
                <VoucherIssuanceForm />
              )}

              {reportType === 'service_completion' && (
                <ServiceCompletionForm />
              )}

              {reportType === 'quarterly_summary' && (
                <QuarterlySummaryForm />
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function VoucherIssuanceForm() {
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-gray-900">Report Voucher Issuance</h2>
      <p className="text-sm text-gray-600">
        Report vouchers issued to pet owners in your service area.
      </p>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Voucher Number
          </label>
          <input
            type="text"
            placeholder="WVSNP-V-XXXXXX"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Issue Date
          </label>
          <input
            type="date"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Pet Owner Name
          </label>
          <input
            type="text"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            County
          </label>
          <select className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900">
            <option value="">Select county...</option>
            <option value="greenbrier">Greenbrier</option>
            <option value="kanawha">Kanawha</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Animal Type
          </label>
          <select className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900">
            <option value="">Select type...</option>
            <option value="dog">Dog</option>
            <option value="cat">Cat</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Assigned Clinic
          </label>
          <input
            type="text"
            placeholder="Clinic name"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
          />
        </div>
      </div>

      <button className="w-full px-6 py-3 bg-green-600 text-white rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500">
        Submit Voucher Report
      </button>
    </div>
  );
}

function ServiceCompletionForm() {
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-gray-900">Report Service Completion</h2>
      <p className="text-sm text-gray-600">
        Report when a veterinary clinic has completed a spay/neuter service.
      </p>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Voucher Number
          </label>
          <input
            type="text"
            placeholder="WVSNP-V-XXXXXX"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Service Date
          </label>
          <input
            type="date"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Veterinary Clinic
        </label>
        <input
          type="text"
          placeholder="Clinic name"
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Procedure Type
          </label>
          <select className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900">
            <option value="">Select procedure...</option>
            <option value="spay">Spay (Female)</option>
            <option value="neuter">Neuter (Male)</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Service Cost
          </label>
          <input
            type="number"
            placeholder="75.00"
            step="0.01"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
          />
        </div>
      </div>

      <div>
        <label className="flex items-center space-x-2 cursor-pointer">
          <input
            type="checkbox"
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm text-gray-700">
            Service completed successfully with no complications
          </span>
        </label>
      </div>

      <button className="w-full px-6 py-3 bg-green-600 text-white rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500">
        Submit Completion Report
      </button>
    </div>
  );
}

function QuarterlySummaryForm() {
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-gray-900">Quarterly Summary Report</h2>
      <p className="text-sm text-gray-600">
        Submit your quarterly summary of WVSNP program activities.
      </p>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Reporting Quarter
          </label>
          <select className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900">
            <option value="">Select quarter...</option>
            <option value="2026-q1">Q1 2026 (Jan-Mar)</option>
            <option value="2026-q2">Q2 2026 (Apr-Jun)</option>
            <option value="2026-q3">Q3 2026 (Jul-Sep)</option>
            <option value="2026-q4">Q4 2026 (Oct-Dec)</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Grant Cycle Year
          </label>
          <select className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900">
            <option value="">Select year...</option>
            <option value="2026">2026</option>
            <option value="2027">2027</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Vouchers Issued
          </label>
          <input
            type="number"
            placeholder="0"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Services Completed
          </label>
          <input
            type="number"
            placeholder="0"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Total Cost
          </label>
          <input
            type="number"
            placeholder="0.00"
            step="0.01"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Program Highlights & Challenges
        </label>
        <textarea
          rows={4}
          placeholder="Describe key achievements, challenges faced, and any program improvements..."
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Veterinary Partner Updates
        </label>
        <textarea
          rows={3}
          placeholder="Any changes to participating clinics, capacity issues, or partnership updates..."
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
        />
      </div>

      <button className="w-full px-6 py-3 bg-green-600 text-white rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500">
        Submit Quarterly Report
      </button>
    </div>
  );
}
