const isPastAllocation = (endDateStr) => {
     const today = new Date();
     today.setHours(0,0,0,0);
     
     // Robust parsing
     let d;
     const clean = endDateStr.trim().replace(/[-/.,]/g, ' ');
     d = new Date(clean);
     
     // If incomplete date like "30 Apr", append current year
     if (isNaN(d.getTime())) {
        d = new Date(`${clean} ${today.getFullYear()}`);
     }
     
     if (isNaN(d.getTime())) return false; // Default to not past if we can't parse
     
     // Set to very end of the day to ensure it stays active/upcoming on that day
     d.setHours(23, 59, 59, 999);
     
     return d.getTime() < new Date().getTime();
};

console.log('2026-05-01:', isPastAllocation('2026-05-01'));
console.log('2026-05-15:', isPastAllocation('2026-05-15'));
