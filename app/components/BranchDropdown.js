// app/components/BranchDropdown.js
"use client";

import React, { useState, useEffect, useRef } from 'react';
import Image from 'next/image';

const BranchDropdown = ({ branches, selectedBranchId, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);
  
  // Get selected branch
  const selectedBranch = branches.find(branch => branch.id === selectedBranchId) || {};
  
  // Branch icon mapping
  const getBranchIcon = (branchName) => {
    const name = branchName.toLowerCase();
    if (name.includes('vegas') || name.includes('lv')) {
      return '/components/assets/icons/lv.png';
    } else if (name.includes('north')) {
      return '/components/assets/icons/n.png';
    } else if (name.includes('southeast') || name.includes('se')) {
      return '/components/assets/icons/se.png';
    } else if (name.includes('southwest') || name.includes('sw')) {
      return '/components/assets/icons/sw.png';
    }
    return null;
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="border rounded-lg pl-8 pr-10 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-medium bg-white shadow-sm flex items-center"
        style={{ minWidth: '180px' }}
      >
        {selectedBranchId ? (
          <div className="flex items-center">
            {selectedBranch.color && (
              <div 
                className="absolute left-2 top-1/2 transform -translate-y-1/2 w-4 h-4 rounded-full shadow-sm"
                style={{ backgroundColor: selectedBranch.color }}
              ></div>
            )}
            <Image 
              src={getBranchIcon(selectedBranch.name) || '/placeholder.png'} 
              alt=""
              width={16}
              height={16}
              className="mr-2"
              onError={(e) => e.target.style.display = 'none'}
            />
            <span>{selectedBranch.name}</span>
          </div>
        ) : (
          <span>All Branches</span>
        )}
        
        <div className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
          <svg className="h-5 w-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </div>
      </button>
      
      {isOpen && (
        <div className="absolute z-10 mt-1 w-full rounded-md bg-white shadow-lg">
          <div className="py-1 max-h-60 overflow-y-auto">
            <button
              type="button"
              className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100"
              onClick={() => {
                onChange(null);
                setIsOpen(false);
              }}
            >
              All Branches
            </button>
            
            {branches.map((branch) => (
              <button
                key={branch.id}
                type="button"
                className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 flex items-center"
                onClick={() => {
                  onChange(branch.id);
                  setIsOpen(false);
                }}
              >
                {branch.color && (
                  <div 
                    className="w-4 h-4 rounded-full mr-2 shadow-sm"
                    style={{ backgroundColor: branch.color }}
                  ></div>
                )}
                <Image 
                  src={getBranchIcon(branch.name) || '/placeholder.png'} 
                  alt=""
                  width={16}
                  height={16}
                  className="mr-2"
                  onError={(e) => e.target.style.display = 'none'}
                />
                <span>{branch.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default BranchDropdown;